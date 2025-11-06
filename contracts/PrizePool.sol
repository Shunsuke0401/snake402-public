// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PrizePool {
    IERC20 public usdc;
    address public owner;
    address public treasury;

    event Deposit(address indexed from, uint256 amount);
    event Payout(address indexed to, uint256 amount);
    event TreasuryWithdraw(address indexed to, uint256 amount);
    event TreasuryChanged(address indexed previous, address indexed newTreasury);

    constructor(address _usdc, address _treasury) {
        usdc = IERC20(_usdc);
        owner = msg.sender;
        treasury = _treasury;
    }

    function deposit(uint256 amount) external {
        usdc.transferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    function endCycle(address[] calldata winners, uint256[] calldata rewards) external {
        require(msg.sender == owner, "Only owner");
        require(winners.length == rewards.length, "Length mismatch");
        for (uint i = 0; i < winners.length; i++) {
            usdc.transfer(winners[i], rewards[i]);
            emit Payout(winners[i], rewards[i]);
        }
    }

    // Owner-only: update treasury address
    function setTreasury(address _treasury) external {
        require(msg.sender == owner, "Only owner");
        require(_treasury != address(0), "Invalid treasury");
        address previous = treasury;
        treasury = _treasury;
        emit TreasuryChanged(previous, _treasury);
    }

    // Owner-only: withdraw a specific amount of USDC to current treasury
    function withdrawTreasury(uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        require(amount > 0, "Amount must be > 0");
        require(usdc.balanceOf(address(this)) >= amount, "Insufficient balance");
        usdc.transfer(treasury, amount);
        emit TreasuryWithdraw(treasury, amount);
    }

    // Owner-only: withdraw to any recipient address
    function withdrawTo(address recipient, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(usdc.balanceOf(address(this)) >= amount, "Insufficient balance");
        usdc.transfer(recipient, amount);
        emit TreasuryWithdraw(recipient, amount);
    }
}