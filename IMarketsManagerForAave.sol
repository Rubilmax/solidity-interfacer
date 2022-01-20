// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.7;

import "./aave/ILendingPoolAddressesProvider.sol";
import "./aave/ILendingPool.sol";
import "./IPositionsManagerForAave.sol";

interface IMarketsManagerForAave {
    function isCreated(address) external view returns (bool);

    function p2pSPY(address) external view returns (uint256);

    function p2pExchangeRate(address) external view returns (uint256);

    function lastUpdateTimestamp(address) external view returns (uint256);

    function positionsManagerForAave() external view returns (IPositionsManagerForAave);

    function addressesProvider() external view returns (ILendingPoolAddressesProvider);

    function lendingPool() external view returns (ILendingPool);

    function setPositionsManager(address _positionsManagerForAave) external;

    function updateLendingPool() external;

    function setNmaxForMatchingEngine(uint16 _newMaxNumber) external;

    function createMarket(address _marketAddress, uint256 _threshold, uint256 _capValue) external;

    function updateThreshold(address _marketAddress, uint256 _newThreshold) external;

    function updateCapValue(address _marketAddress, uint256 _newCapValue) external;

    function updateRates(address _marketAddress) external;
}