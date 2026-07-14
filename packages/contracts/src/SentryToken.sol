// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title SentryToken
/// @notice Fixed-supply ERC-20 utility token for Hood Sentry.
/// No transfer tax, no blacklist, no pause, no confiscation, no rebasing.
/// Not upgradeable.
contract SentryToken is ERC20, ERC20Permit {
    constructor(
        string memory name_,
        string memory symbol_,
        address initialRecipient,
        uint256 totalSupply_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        require(initialRecipient != address(0), "SentryToken: zero recipient");
        require(totalSupply_ > 0, "SentryToken: zero supply");
        _mint(initialRecipient, totalSupply_);
    }
}
