// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CROPSVault is ERC4626, Ownable {
    mapping(address => uint256) public cropsScore;
    address[] public protocols;

    event ScoreUpdated(address indexed protocol, uint256 score);
    event Rebalanced(address indexed protocol, uint256 amount);

    constructor(IERC20 _asset)
        ERC4626(_asset)
        ERC20("CROPS Vault Share", "CROPS")
        Ownable(msg.sender)
    {}

    // Only the score delta is committed — private documents never logged
    function updateScore(address protocol, uint256 score) external onlyOwner {
        require(score <= 10000, "Score must be <= 10000");
        if (cropsScore[protocol] == 0) {
            protocols.push(protocol);
        }
        cropsScore[protocol] = score;
        emit ScoreUpdated(protocol, score);
    }

    function getTopProtocols() external view returns (address[] memory, uint256[] memory) {
        uint256[] memory scores = new uint256[](protocols.length);
        for (uint256 i = 0; i < protocols.length; i++) {
            scores[i] = cropsScore[protocols[i]];
        }
        return (protocols, scores);
    }
}
