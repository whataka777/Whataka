// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* Pool de ensayo (constante producto x*y=k) para WhaTaka.
 *
 * NO es un DEX de producción: es un pool mínimo para PRACTICAR en una testnet
 * la mecánica de liquidez, precio y compra/venta con el token WTK real, sin
 * gastar dinero. En Polygon mainnet se usará QuickSwap (Uniswap V2), cuya
 * aritmética es la misma.
 *
 * Precio del WTK = reserveBase / reserveWtk. Tú decides el precio inicial
 * eligiendo cuánta base (p. ej. USDC de prueba) pones frente a cuántos WTK.
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract TestPool {
    address public immutable wtk;   // token que queremos dar valor
    address public immutable base;  // moneda "de referencia" (USDC de prueba)

    uint256 public reserveWtk;
    uint256 public reserveBase;

    uint256 public constant FEE_BPS = 30; // 0,30 % por operación

    event LiquidityAdded(address indexed who, uint256 wtkIn, uint256 baseIn);
    event LiquidityRemoved(address indexed who, uint256 wtkOut, uint256 baseOut);
    event Swap(address indexed who, bool wtkIn, uint256 amountIn, uint256 amountOut);

    constructor(address _wtk, address _base) {
        require(_wtk != address(0) && _base != address(0), "direccion cero");
        wtk = _wtk;
        base = _base;
    }

    /// @notice Precio del WTK expresado en base, con 18 decimales.
    function priceWtkInBase() external view returns (uint256) {
        if (reserveWtk == 0) return 0;
        return (reserveBase * 1e18) / reserveWtk;
    }

    function reserves() external view returns (uint256, uint256) {
        return (reserveWtk, reserveBase);
    }

    /// @notice Añade liquidez: el llamante debe haber aprobado antes ambos tokens.
    function addLiquidity(uint256 wtkAmount, uint256 baseAmount) external {
        require(wtkAmount > 0 && baseAmount > 0, "montos cero");
        require(IERC20(wtk).transferFrom(msg.sender, address(this), wtkAmount), "wtk fallo");
        require(IERC20(base).transferFrom(msg.sender, address(this), baseAmount), "base fallo");
        reserveWtk += wtkAmount;
        reserveBase += baseAmount;
        emit LiquidityAdded(msg.sender, wtkAmount, baseAmount);
    }

    /// @notice Retira liquidez de forma proporcional a la participación pedida.
    ///         shareBps = partes por 10.000 del pool (10.000 = todo).
    function removeLiquidity(uint256 shareBps) external {
        require(shareBps > 0 && shareBps <= 10000, "share invalido");
        uint256 wtkOut = (reserveWtk * shareBps) / 10000;
        uint256 baseOut = (reserveBase * shareBps) / 10000;
        reserveWtk -= wtkOut;
        reserveBase -= baseOut;
        require(IERC20(wtk).transfer(msg.sender, wtkOut), "wtk fallo");
        require(IERC20(base).transfer(msg.sender, baseOut), "base fallo");
        emit LiquidityRemoved(msg.sender, wtkOut, baseOut);
    }

    /// @dev Salida por constante producto con comisión.
    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS);
        uint256 num = amountInWithFee * reserveOut;
        uint256 den = (reserveIn * 10000) + amountInWithFee;
        return num / den;
    }

    /// @notice Cambia WTK por base. El llamante debe aprobar WTK antes.
    function swapWtkForBase(uint256 wtkIn) external returns (uint256 baseOut) {
        require(wtkIn > 0, "monto cero");
        baseOut = _amountOut(wtkIn, reserveWtk, reserveBase);
        require(baseOut > 0 && baseOut < reserveBase, "liquidez insuficiente");
        require(IERC20(wtk).transferFrom(msg.sender, address(this), wtkIn), "wtk fallo");
        reserveWtk += wtkIn;
        reserveBase -= baseOut;
        require(IERC20(base).transfer(msg.sender, baseOut), "base fallo");
        emit Swap(msg.sender, true, wtkIn, baseOut);
    }

    /// @notice Cambia base por WTK. El llamante debe aprobar base antes.
    function swapBaseForWtk(uint256 baseIn) external returns (uint256 wtkOut) {
        require(baseIn > 0, "monto cero");
        wtkOut = _amountOut(baseIn, reserveBase, reserveWtk);
        require(wtkOut > 0 && wtkOut < reserveWtk, "liquidez insuficiente");
        require(IERC20(base).transferFrom(msg.sender, address(this), baseIn), "base fallo");
        reserveBase += baseIn;
        reserveWtk -= wtkOut;
        require(IERC20(wtk).transfer(msg.sender, wtkOut), "wtk fallo");
        emit Swap(msg.sender, false, baseIn, wtkOut);
    }
}
