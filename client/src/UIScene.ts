import Phaser from 'phaser';

export class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private gameOverContainer!: Phaser.GameObjects.Container;
  private gameOverBackground!: Phaser.GameObjects.Rectangle;
  private gameOverText!: Phaser.GameObjects.Text;
  private finalScoreText!: Phaser.GameObjects.Text;
  private personalStatsText!: Phaser.GameObjects.Text;
  private restartButton!: Phaser.GameObjects.Text;

  private gameScene!: Phaser.Scene;
  private goHomeCallback?: () => void;
  private walletAddress?: string;
  private sessionId?: string;
  private onSessionExpired?: () => void;

  constructor() {
    super({ key: 'UIScene' });
  }

  init(data: { goHomeCallback?: () => void; walletAddress?: string; sessionId?: string; onSessionExpired?: () => void }) {
    this.goHomeCallback = data.goHomeCallback;
    this.walletAddress = data.walletAddress;
    this.sessionId = data.sessionId;
    this.onSessionExpired = data.onSessionExpired;
  }

  create() {
    // Get reference to game scene
    this.gameScene = this.scene.get('GameScene');

    // Get screen dimensions for responsive positioning
    const { width, height } = this.scale;

    // Create score display above the game grid (centered)
    this.scoreText = this.add.text(width / 2, 30, '🍎 0', {
      fontSize: '28px',
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0.5);

    // Create instructions text (centered above game area)
    this.add.text(width / 2, 60, 'Use Arrow Keys or WASD to move', {
      fontSize: '16px',
      color: '#cccccc',
      fontFamily: 'Arial'
    }).setOrigin(0.5, 0.5);

    // Create game over overlay (initially hidden)
    this.createGameOverOverlay();

    // Listen for game events
    this.gameScene.events.on('scoreUpdate', this.updateScore, this);
    this.gameScene.events.on('gameOver', this.showGameOver, this);
    this.gameScene.events.on('gameRestart', this.hideGameOver, this);

    // Listen for resize events to reposition elements
    this.scale.on('resize', this.resize, this);
  }

  private createGameOverOverlay() {
    // Get screen dimensions for responsive positioning
    const { width, height } = this.scale;
    
    // Create container for game over elements (centered on screen)
    this.gameOverContainer = this.add.container(width / 2, height / 2);

    // Semi-transparent background (made larger for more content)
    this.gameOverBackground = this.add.rectangle(0, 0, 500, 400, 0x000000, 0.8);
    this.gameOverBackground.setStrokeStyle(2, 0xffffff);

    // Game Over text
    this.gameOverText = this.add.text(0, -140, 'GAME OVER', {
      fontSize: '48px',
      color: '#ff4444',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // Final score text
    this.finalScoreText = this.add.text(0, -80, 'Final Score: 0', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial'
    }).setOrigin(0.5);

    // Personal stats text (will be populated after score submission)
    this.personalStatsText = this.add.text(0, -30, 'Submitting score...', {
      fontSize: '18px',
      color: '#cccccc',
      fontFamily: 'Arial',
      align: 'center'
    }).setOrigin(0.5);

    // Go Home button (previously restart button)
    this.restartButton = this.add.text(0, 60, 'GO HOME', {
      fontSize: '32px',
      color: '#00ff00',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      backgroundColor: '#004400',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5);

    // Make go home button interactive
    this.restartButton.setInteractive({ useHandCursor: true });
    this.restartButton.on('pointerdown', this.restartGame, this);
    this.restartButton.on('pointerover', () => {
      this.restartButton.setStyle({ backgroundColor: '#006600' });
    });
    this.restartButton.on('pointerout', () => {
      this.restartButton.setStyle({ backgroundColor: '#004400' });
    });

    // Instructions for go home
    const restartInstructions = this.add.text(0, 120, 'Click to go home or press SPACE', {
      fontSize: '16px',
      color: '#cccccc',
      fontFamily: 'Arial'
    }).setOrigin(0.5);

    // Add all elements to container
    this.gameOverContainer.add([
      this.gameOverBackground,
      this.gameOverText,
      this.finalScoreText,
      this.personalStatsText,
      this.restartButton,
      restartInstructions
    ]);

    // Hide initially
    this.gameOverContainer.setVisible(false);

    // Add keyboard restart functionality
    this.input.keyboard!.on('keydown-SPACE', () => {
      if (this.gameOverContainer.visible) {
        this.restartGame();
      }
    });
  }

  private updateScore(score: number) {
    this.scoreText.setText(`🍎 ${score}`);
  }

  private async showGameOver(finalScore: number) {
    this.finalScoreText.setText(`Final Score: ${finalScore}`);
    this.personalStatsText.setText('Submitting score...');
    this.gameOverContainer.setVisible(true);
    
    // Add a subtle animation
    this.gameOverContainer.setScale(0.8);
    this.tweens.add({
      targets: this.gameOverContainer,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut'
    });

    // Submit score to server if we have wallet and session data
    if (this.walletAddress && this.sessionId) {
      try {
        await this.submitScore(finalScore);
      } catch (error) {
        console.error('Failed to submit score:', error);
        this.personalStatsText.setText('Failed to submit score');
      }
    } else {
      this.personalStatsText.setText('Score not submitted (missing session data)');
    }
  }

  private async submitScore(score: number): Promise<void> {
    try {
      // Submit score to server
      const response = await fetch('http://localhost:3001/api/submit-score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          wallet: this.walletAddress,
          score: score
        })
      });

      if (!response.ok) {
        throw new Error(`Score submission failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('Score submitted successfully:', result);

      // Check if session expired (pay-per-game enforcement)
      if (result.sessionExpired && this.onSessionExpired) {
        console.log('Session expired - payment required for next game');
        this.onSessionExpired();
      }

      // Fetch updated daily player stats
      const statsResponse = await fetch(`http://localhost:3001/player/daily/${this.walletAddress}`);
      
      if (statsResponse.ok) {
        const playerStats = await statsResponse.json();
        this.personalStatsText.setText(
          `Today's Total Score: ${playerStats.totalScoreDaily ?? 0}\n` +
          `Today's High Score: ${playerStats.highScoreDaily ?? 0}\n` +
          `Today's Games: ${playerStats.gamesPlayedDaily ?? 0}\n\n` +
          `💰 Payment required for next game!`
        );
      } else {
        this.personalStatsText.setText('Score submitted successfully!\n💰 Payment required for next game!');
      }
    } catch (error) {
      console.error('Error submitting score:', error);
      throw error;
    }
  }

  private hideGameOver() {
    this.gameOverContainer.setVisible(false);
    this.scoreText.setText('Score: 0');
    this.personalStatsText.setText('Submitting score...');
  }

  private restartGame() {
    // Call go home callback if available, otherwise fall back to restart
    if (this.goHomeCallback) {
      this.goHomeCallback();
    } else {
      // Fallback to restart method on game scene
      (this.gameScene as any).restartGame();
    }
  }

  private resize(gameSize: Phaser.Structs.Size) {
    const { width, height } = gameSize;
    
    // Reposition score text
    this.scoreText.setPosition(width / 2, 30);
    
    // Reposition game over container
    this.gameOverContainer.setPosition(width / 2, height / 2);
  }

  shutdown() {
    // Clean up event listeners
    if (this.gameScene && this.gameScene.events) {
      this.gameScene.events.off('scoreUpdate', this.updateScore, this);
      this.gameScene.events.off('gameOver', this.showGameOver, this);
      this.gameScene.events.off('gameRestart', this.hideGameOver, this);
    }
  }
}