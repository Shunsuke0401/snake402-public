import Phaser from 'phaser';

interface SnakeSegment {
  x: number;
  y: number;
}

export class GameScene extends Phaser.Scene {
  private snake: SnakeSegment[] = [];
  private apple: { x: number; y: number } | null = null;
  private direction: { x: number; y: number } = { x: 1, y: 0 };
  private nextDirection: { x: number; y: number } = { x: 1, y: 0 };
  private score: number = 0;
  private applesEaten: number = 0; // Track number of red apples eaten
  private gameOver: boolean = false;
  private lastMoveTime: number = 0;
  private moveDelay: number = 150; // milliseconds between moves
  
  // Game grid settings
  private readonly CELL_SIZE = 40; // Larger cells for 15x15 grid
  private readonly GRID_WIDTH = 15; // 15x15 grid
  private readonly GRID_HEIGHT = 15; // 15x15 grid
  
  // Calculate game area and positioning
  private GAME_AREA_WIDTH!: number;
  private GAME_AREA_HEIGHT!: number;
  private GAME_OFFSET_X!: number;
  private GAME_OFFSET_Y!: number;
  
  // Graphics objects
  private snakeGraphics!: Phaser.GameObjects.Graphics;
  private appleGraphics!: Phaser.GameObjects.Graphics;
  private borderGraphics!: Phaser.GameObjects.Graphics;
  private appleText!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    // Calculate game area dimensions and positioning
    this.GAME_AREA_WIDTH = this.GRID_WIDTH * this.CELL_SIZE; // 600px
    this.GAME_AREA_HEIGHT = this.GRID_HEIGHT * this.CELL_SIZE; // 600px
    
    // Center the game area on the current canvas size
    const canvasWidth = this.cameras.main.width;
    const canvasHeight = this.cameras.main.height;
    this.GAME_OFFSET_X = (canvasWidth - this.GAME_AREA_WIDTH) / 2; // Center horizontally
    this.GAME_OFFSET_Y = (canvasHeight - this.GAME_AREA_HEIGHT) / 2; // Center vertically
    
    // Set canvas background to a darker color to contrast with game area
    this.cameras.main.setBackgroundColor(0x34495e);
    
    // Initialize game state
    this.score = 0;
    this.gameOver = false;
    this.applesEaten = 0;
    
    // Initialize snake in the center
    this.snake = [
      { x: Math.floor(this.GRID_WIDTH / 2), y: Math.floor(this.GRID_HEIGHT / 2) }
    ];
    
    // Set initial direction
    this.direction = { x: 1, y: 0 };
    this.nextDirection = { x: 1, y: 0 };
    
    // Create graphics objects with explicit depth ordering
    this.borderGraphics = this.add.graphics();
    this.borderGraphics.setDepth(0); // Background layer
    
    this.snakeGraphics = this.add.graphics();
    this.snakeGraphics.setDepth(2); // Foreground layer
    
    this.appleGraphics = this.add.graphics();
    this.appleGraphics.setDepth(1); // Middle layer
    
    // Draw initial border
    this.drawBorder();
    
    // Spawn first apple
    this.spawnApple();
    
    // Initial render to show snake and apple
    this.render();
    
    // Set up input
    this.setupInput();
    
    // Start the UI scene
    this.scene.launch('UIScene');
    
    // Emit initial score
    this.events.emit('scoreUpdate', this.score);
  }

  private setupInput() {
    // Set up input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,S,A,D') as any;
  }

  private drawBorder() {
    this.borderGraphics.clear();
    
    // Draw game area background (white)
    this.borderGraphics.fillStyle(0xffffff);
    this.borderGraphics.fillRect(
      this.GAME_OFFSET_X, 
      this.GAME_OFFSET_Y, 
      this.GAME_AREA_WIDTH, 
      this.GAME_AREA_HEIGHT
    );

    // Draw border around the entire game area
    this.borderGraphics.lineStyle(4, 0x2c3e50);
    this.borderGraphics.strokeRect(
      this.GAME_OFFSET_X, 
      this.GAME_OFFSET_Y, 
      this.GAME_AREA_WIDTH, 
      this.GAME_AREA_HEIGHT
    );

    // Draw grid lines (light grey) - borders for each tile
    this.borderGraphics.lineStyle(1, 0x95a5a6);
    
    // Vertical lines (creating columns)
    for (let i = 1; i < this.GRID_WIDTH; i++) {
      const x = this.GAME_OFFSET_X + i * this.CELL_SIZE;
      this.borderGraphics.moveTo(x, this.GAME_OFFSET_Y);
      this.borderGraphics.lineTo(x, this.GAME_OFFSET_Y + this.GAME_AREA_HEIGHT);
    }
    
    // Horizontal lines (creating rows)
    for (let i = 1; i < this.GRID_HEIGHT; i++) {
      const y = this.GAME_OFFSET_Y + i * this.CELL_SIZE;
      this.borderGraphics.moveTo(this.GAME_OFFSET_X, y);
      this.borderGraphics.lineTo(this.GAME_OFFSET_X + this.GAME_AREA_WIDTH, y);
    }
    
    // Make sure to stroke the path to render the grid lines
    this.borderGraphics.strokePath();
  }

  update(_time: number, delta: number) {
    if (this.gameOver) return;

    // Handle input
    this.handleInput();

    // Update move timer
    this.lastMoveTime += delta;
    
    if (this.lastMoveTime >= this.moveDelay) {
      this.moveSnake();
      this.lastMoveTime = 0;
    }

    // Render game objects
    this.render();
  }

  private handleInput() {
    // Prevent reverse direction
    const canChangeDirection = (newDir: { x: number; y: number }) => {
      return !(newDir.x === -this.direction.x && newDir.y === -this.direction.y);
    };

    // Arrow keys
    if (this.cursors.left.isDown && canChangeDirection({ x: -1, y: 0 })) {
      this.nextDirection = { x: -1, y: 0 };
    } else if (this.cursors.right.isDown && canChangeDirection({ x: 1, y: 0 })) {
      this.nextDirection = { x: 1, y: 0 };
    } else if (this.cursors.up.isDown && canChangeDirection({ x: 0, y: -1 })) {
      this.nextDirection = { x: 0, y: -1 };
    } else if (this.cursors.down.isDown && canChangeDirection({ x: 0, y: 1 })) {
      this.nextDirection = { x: 0, y: 1 };
    }

    // WASD keys
    if (this.wasdKeys.A.isDown && canChangeDirection({ x: -1, y: 0 })) {
      this.nextDirection = { x: -1, y: 0 };
    } else if (this.wasdKeys.D.isDown && canChangeDirection({ x: 1, y: 0 })) {
      this.nextDirection = { x: 1, y: 0 };
    } else if (this.wasdKeys.W.isDown && canChangeDirection({ x: 0, y: -1 })) {
      this.nextDirection = { x: 0, y: -1 };
    } else if (this.wasdKeys.S.isDown && canChangeDirection({ x: 0, y: 1 })) {
      this.nextDirection = { x: 0, y: 1 };
    }
  }

  private moveSnake() {
    // Update direction
    this.direction = { ...this.nextDirection };

    // Calculate new head position
    const head = this.snake[0];
    const newHead: SnakeSegment = {
      x: head.x + this.direction.x,
      y: head.y + this.direction.y
    };

    // Check wall collision
    if (newHead.x < 0 || newHead.x >= this.GRID_WIDTH || 
        newHead.y < 0 || newHead.y >= this.GRID_HEIGHT) {
      this.triggerGameOver();
      return;
    }

    // Check self collision
    if (this.snake.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
      this.triggerGameOver();
      return;
    }

    // Add new head
    this.snake.unshift(newHead);

    // Check apple collision
    if (this.apple && newHead.x === this.apple.x && newHead.y === this.apple.y) {
      this.eatApple();
    } else {
      // Remove tail if no apple eaten
      this.snake.pop();
    }
  }

  private spawnApple() {
    let validPosition = false;
    let attempts = 0;
    
    while (!validPosition && attempts < 100) {
      const x = Math.floor(Math.random() * this.GRID_WIDTH);
      const y = Math.floor(Math.random() * this.GRID_HEIGHT);
      
      // Check if position is not occupied by snake
      if (!this.snake.some(segment => segment.x === x && segment.y === y)) {
        this.apple = { x, y };
        validPosition = true;
      }
      attempts++;
    }
  }

  private eatApple() {
    // Increment apples eaten counter
    this.applesEaten += 1;
    
    // Score is equal to the number of red apples eaten
    this.score = this.applesEaten;
    
    this.spawnApple();
    
    // Emit score update event
    this.events.emit('scoreUpdate', this.score);
    
    // Slightly increase speed (decrease delay) as score increases
    this.moveDelay = Math.max(80, 150 - Math.floor(this.score / 5) * 5);
  }

  private triggerGameOver() {
    this.gameOver = true;
    this.events.emit('gameOver', this.score);
  }

  private render() {
    // Clear and draw game objects
    this.snakeGraphics.clear();
    this.appleGraphics.clear();

    // Draw snake segments
    this.snake.forEach((segment, index) => {
      if (index === 0) {
        // Head - darker green
        this.snakeGraphics.fillStyle(0x27ae60);
      } else {
        // Body - lighter green
        this.snakeGraphics.fillStyle(0x2ecc71);
      }
      
      const x = this.GAME_OFFSET_X + segment.x * this.CELL_SIZE + 1;
      const y = this.GAME_OFFSET_Y + segment.y * this.CELL_SIZE + 1;
      
      this.snakeGraphics.fillRect(
        x,
        y,
        this.CELL_SIZE - 2,
        this.CELL_SIZE - 2
      );
    });

    // Draw apple using text emoji
    if (this.apple) {
      const x = this.GAME_OFFSET_X + this.apple.x * this.CELL_SIZE + this.CELL_SIZE / 2;
      const y = this.GAME_OFFSET_Y + this.apple.y * this.CELL_SIZE + this.CELL_SIZE / 2;
      
      // Clear any existing apple text and create new one
      if (this.appleText) {
        this.appleText.destroy();
      }
      
      this.appleText = this.add.text(x, y, '🍎', {
        fontSize: '32px',
        align: 'center'
      });
      this.appleText.setOrigin(0.5, 0.5);
      this.appleText.setDepth(1);
    }
  }

  public restartGame() {
    // Reset game state
    this.snake = [
      { x: Math.floor(this.GRID_WIDTH / 2), y: Math.floor(this.GRID_HEIGHT / 2) },
      { x: Math.floor(this.GRID_WIDTH / 2) - 1, y: Math.floor(this.GRID_HEIGHT / 2) },
      { x: Math.floor(this.GRID_WIDTH / 2) - 2, y: Math.floor(this.GRID_HEIGHT / 2) }
    ];
    
    this.direction = { x: 1, y: 0 };
    this.nextDirection = { x: 1, y: 0 };
    this.score = 0;
    this.applesEaten = 0;
    this.gameOver = false;
    this.lastMoveTime = 0;
    this.moveDelay = 150;

    // Spawn new apple
    this.spawnApple();

    // Emit restart event
    this.events.emit('gameRestart');
  }

  public resize(width: number, height: number) {
    // Recalculate positioning for new canvas size
    this.GAME_OFFSET_X = (width - this.GAME_AREA_WIDTH) / 2;
    this.GAME_OFFSET_Y = (height - this.GAME_AREA_HEIGHT) / 2;
    
    // Redraw everything with new positioning
    this.drawBorder();
    this.render();
  }
}