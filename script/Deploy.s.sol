// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {CROPSVault} from "../src/Vault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployScript is Script {
    // USDC on Base Sepolia testnet
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        vm.startBroadcast();
        new CROPSVault(IERC20(USDC));
        vm.stopBroadcast();
    }
}
