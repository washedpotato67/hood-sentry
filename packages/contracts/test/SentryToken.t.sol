// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SentryToken} from "../src/SentryToken.sol";

contract SentryTokenTest is Test {
    SentryToken token;
    address deployer = address(0x1);
    address recipient = address(0x2);
    uint256 constant TOTAL_SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        token = new SentryToken("Hood Sentry", "SENTRY", recipient, TOTAL_SUPPLY);
    }

    function test_name() public view {
        assertEq(token.name(), "Hood Sentry");
    }

    function test_symbol() public view {
        assertEq(token.symbol(), "SENTRY");
    }

    function test_totalSupply() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }

    function test_initialBalance() public view {
        assertEq(token.balanceOf(recipient), TOTAL_SUPPLY);
    }

    function test_transfer() public {
        vm.prank(recipient);
        token.transfer(deployer, 100 ether);
        assertEq(token.balanceOf(deployer), 100 ether);
        assertEq(token.balanceOf(recipient), TOTAL_SUPPLY - 100 ether);
    }

    function test_noMintFunction() public {
        // SentryToken has no mint function after construction
        // This is enforced by the absence of a public mint function
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }
}
