// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * WhaTakaTTC — token TTC con emisión controlada y minería sostenible
 * -----------------------------------------------------------------
 * Contrato autocontenido: es a la vez el ERC-20 de TTC y el sistema que paga
 * las recompensas de minería. Sustituye a la pareja (token externo +
 * WhaTakaMiningRewards) cuando quieres que WhaTaka controle su propia emisión.
 *
 * Objetivo económico: que el fondo de minería no se agote nunca y que el token
 * no se infle sin control. Para eso combina tres piezas:
 *
 *   1. HALVING (escasez). La recompensa por punto de score se parte por la
 *      mitad cada `halvingInterval` segundos, igual que Bitcoin. Así cada vez
 *      hacen falta más nodos y más tiempo para emitir la misma cantidad de TTC.
 *
 *   2. TOPE ANUAL DE EMISIÓN (antiinflación). Solo se pueden acuñar
 *      `annualMintCap` TTC por año. Es un techo duro: aunque el halving no
 *      bastara, la inflación nunca supera ese número.
 *
 *   3. ECONOMÍA CIRCULAR (sostenibilidad). Las comisiones que la app recolecta
 *      por servicios especiales vuelven al fondo de minería con
 *      `recycleFees`. Ese dinero no se acuña, así que reduce la necesidad de
 *      emitir y presiona el precio hacia arriba.
 *
 * MODELO DE CONFIANZA (IMPORTANTE)
 *   `claimMiningReward` NO se fía de las unidades que envía quien llama. Si lo
 *   hiciera, cualquiera podría reclamar con relayUnits = 1e9 y vaciar el fondo.
 *   Cada reclamo exige un "vale" firmado fuera de la cadena por `reportSigner`
 *   (la clave del backend que ya verifica los reportes ECDSA en el relé). El
 *   contrato recalcula el hash, recupera al firmante con ecrecover y solo paga
 *   si coincide. El vale va atado a la cadena, al contrato, al usuario y a una
 *   fecha límite, así que no se puede reutilizar ni adelantar.
 *
 *   El contrato calcula el IMPORTE (aplicando el halving vigente); el backend
 *   solo certifica las unidades. Así el backend no necesita conocer la época.
 */

/// @notice Interfaz ERC-20 estándar.
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract WhaTakaTTC is IERC20 {
    // ─────────────────────────────────────────────────────────────
    // ERC-20
    // ─────────────────────────────────────────────────────────────

    string public constant name = "WhaTaka Token";
    string public constant symbol = "TTC";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ─────────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────────

    /// @notice Dueño: ajusta parámetros, pausa y rescata fondos.
    address public owner;

    /// @notice Backend autorizado a firmar vales de minería.
    address public reportSigner;

    /// @notice Direcciones que pueden acuñar hacia el fondo de minería.
    mapping(address => bool) public minters;

    // ─────────────────────────────────────────────────────────────
    // Emisión y halving
    // ─────────────────────────────────────────────────────────────

    /// @notice Momento del despliegue: origen de las épocas y del año 0.
    uint256 public immutable startTime;

    /// @notice Duración de una época (segundos). Cada época parte la recompensa.
    uint256 public halvingInterval;

    /// @notice TTC (en wei) por punto de score durante la época 0.
    ///         `rewardFactor` se va dividiendo por 2 en cada halving.
    uint256 public rewardFactor;

    /// @notice Suelo de `rewardFactor` para que la minería no llegue nunca a cero.
    uint256 public minRewardFactor;

    /// @notice Un año de emisión (base del tope anual).
    uint256 public constant YEAR = 365 days;

    /// @notice Máximo de TTC (en wei) acuñables por año. Techo duro de inflación.
    uint256 public annualMintCap;

    /// @notice TTC ya acuñados (no génesis) en cada año.
    mapping(uint256 => uint256) public mintedInYear;

    /// @notice Si es `true`, un reclamo acuña lo que falte para pagar (dentro del
    ///         tope anual) cuando el fondo no alcanza. Si es `false`, el reclamo
    ///         revierte y alguien tiene que fondear el pool a mano.
    bool public autoMintTopUp = true;

    // ─────────────────────────────────────────────────────────────
    // Minería
    // ─────────────────────────────────────────────────────────────

    uint256 public relayWeight = 5;
    uint256 public storeWeight = 8;
    uint256 public uptimeWeight = 1;
    uint256 public callWeight = 10;
    uint256 public reputationWeight = 3;

    /// @notice Tope por unidad, para que la aritmética nunca desborde.
    uint256 public constant MAX_UNITS = 1e9;

    /// @notice Tope de pago por reporte (0 = sin tope). Frena errores del backend.
    uint256 public maxRewardPerReport = 1_000_000e18;

    /// @notice reportHash ya pagado. Corta el doble gasto.
    mapping(bytes32 => bool) public processedReports;

    /// @notice Emergencia: detiene acuñación y reclamos.
    bool public paused;

    // ─────────────────────────────────────────────────────────────
    // Eventos
    // ─────────────────────────────────────────────────────────────

    event Minted(address indexed to, uint256 amount, uint256 indexed year);
    event FeesRecycled(address indexed from, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount, bytes32 reportHash);
    event ReportSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event MinterUpdated(address indexed minter, bool allowed);
    event WeightsUpdated(uint256 relay, uint256 store, uint256 uptime, uint256 call, uint256 reputation);
    event HalvingIntervalUpdated(uint256 previousInterval, uint256 newInterval);
    event RewardFactorUpdated(uint256 previousFactor, uint256 newFactor);
    event MinRewardFactorUpdated(uint256 previousFactor, uint256 newFactor);
    event AnnualMintCapUpdated(uint256 previousCap, uint256 newCap);
    event MaxRewardUpdated(uint256 previousMax, uint256 newMax);
    event AutoMintTopUpUpdated(bool enabled);
    event PausedUpdated(bool isPaused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokensRescued(address indexed to, uint256 amount);

    /// @dev Semieje del orden de secp256k1, para descartar firmas maleables.
    uint256 private constant _SECP256K1_HALF_N =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    modifier onlyOwner() {
        require(msg.sender == owner, "No autorizado");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner, "No es minter");
        _;
    }

    /// @param _reportSigner    Dirección del backend que firma los vales.
    /// @param _initialSupply   TTC iniciales (génesis). Van directos al fondo de
    ///                         minería y NO cuentan contra el tope anual.
    /// @param _halvingInterval Segundos por época. 0 → un año.
    /// @param _rewardFactor    TTC por punto en la época 0 (wei). 0 → 1e15.
    /// @param _annualMintCap   Tope de acuñación por año (wei).
    constructor(
        address _reportSigner,
        uint256 _initialSupply,
        uint256 _halvingInterval,
        uint256 _rewardFactor,
        uint256 _annualMintCap
    ) {
        require(_reportSigner != address(0), "firmante cero");

        owner = msg.sender;
        minters[msg.sender] = true;
        reportSigner = _reportSigner;

        startTime = block.timestamp;
        halvingInterval = _halvingInterval == 0 ? YEAR : _halvingInterval;
        rewardFactor = _rewardFactor == 0 ? 1e15 : _rewardFactor;
        minRewardFactor = 1;
        annualMintCap = _annualMintCap;

        // El génesis se acuña directamente al pool para que la minería arranque
        // sin depender de una acuñación posterior.
        if (_initialSupply > 0) {
            _mint(address(this), _initialSupply);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Emisión: halving, épocas y tope anual
    // ─────────────────────────────────────────────────────────────

    /// @notice Época actual. Empieza en 0 y sube una vez por `halvingInterval`.
    function currentEpoch() public view returns (uint256) {
        if (halvingInterval == 0) return 0;
        return (block.timestamp - startTime) / halvingInterval;
    }

    /// @notice Recompensa (wei TTC por punto de score) vigente en una época.
    ///         Es `rewardFactor >> epoch`, con suelo `minRewardFactor`.
    function rewardFactorAt(uint256 epoch) public view returns (uint256) {
        if (epoch >= 256) return minRewardFactor;
        uint256 factor = rewardFactor >> epoch; // un halving por época
        return factor < minRewardFactor ? minRewardFactor : factor;
    }

    /// @notice Recompensa vigente por punto de score (época actual).
    function currentRewardFactor() public view returns (uint256) {
        return rewardFactorAt(currentEpoch());
    }

    /// @notice Cuándo ocurrirá el próximo halving (segundos epoch).
    function nextHalvingTime() public view returns (uint256) {
        if (halvingInterval == 0) return type(uint256).max;
        return startTime + (currentEpoch() + 1) * halvingInterval;
    }

    /// @notice Año de emisión actual (0 = primer año desde el despliegue).
    function yearIndex() public view returns (uint256) {
        return (block.timestamp - startTime) / YEAR;
    }

    /// @notice TTC acuñados (sin contar génesis) en el año actual.
    function mintedThisYear() public view returns (uint256) {
        return mintedInYear[yearIndex()];
    }

    /// @notice Cuánto se puede acuñar todavía este año.
    function remainingAnnualMint() public view returns (uint256) {
        uint256 used = mintedInYear[yearIndex()];
        return used >= annualMintCap ? 0 : annualMintCap - used;
    }

    // ─────────────────────────────────────────────────────────────
    // Puntuación y recompensa
    // ─────────────────────────────────────────────────────────────

    /// @notice Puntuación total: cada unidad multiplicada por su peso.
    function scoreOf(
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits
    ) public view returns (uint256) {
        return relayUnits * relayWeight
            + storeUnits * storeWeight
            + uptimeUnits * uptimeWeight
            + callUnits * callWeight
            + reputationUnits * reputationWeight;
    }

    /// @notice TTC (en wei) que corresponden a esas unidades HOY, ya con el
    ///         halving aplicado.
    function rewardFor(
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits
    ) public view returns (uint256) {
        uint256 score = scoreOf(relayUnits, storeUnits, uptimeUnits, callUnits, reputationUnits);
        return score * currentRewardFactor();
    }

    /// @notice Hash que el backend firma y el contrato verifica. Liga el vale a
    ///         esta cadena, a este contrato, al usuario y a una fecha límite.
    function voucherDigest(
        bytes32 reportHash,
        address user,
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                user,
                reportHash,
                relayUnits,
                storeUnits,
                uptimeUnits,
                callUnits,
                reputationUnits,
                deadline
            )
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Reclamo de recompensa
    // ─────────────────────────────────────────────────────────────

    /// @notice Reclama la recompensa de un reporte firmado por el backend.
    /// @param reportHash      Identificador único del reporte (corta el doble pago).
    /// @param relayUnits      Unidades de relay acumuladas.
    /// @param storeUnits      Unidades de almacenamiento acumuladas.
    /// @param uptimeUnits     Unidades de uptime acumuladas.
    /// @param callUnits       Unidades de llamadas acumuladas.
    /// @param reputationUnits Unidades de reputación acumuladas.
    /// @param deadline        Fecha (segundos epoch) hasta la que vale la firma.
    /// @param signature       Firma del backend (r || s || v) sobre `voucherDigest`.
    function claimMiningReward(
        bytes32 reportHash,
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(!paused, "Contrato pausado");
        require(block.timestamp <= deadline, "Vale expirado");
        require(!processedReports[reportHash], "Reporte ya procesado");

        // Cota de cordura: evita valores absurdos y cualquier desbordamiento.
        require(
            relayUnits <= MAX_UNITS
                && storeUnits <= MAX_UNITS
                && uptimeUnits <= MAX_UNITS
                && callUnits <= MAX_UNITS
                && reputationUnits <= MAX_UNITS,
            "Unidades fuera de rango"
        );

        // Solo pagamos si el vale lo firmó el backend para ESTE usuario.
        bytes32 digest = voucherDigest(
            reportHash,
            msg.sender,
            relayUnits,
            storeUnits,
            uptimeUnits,
            callUnits,
            reputationUnits,
            deadline
        );
        require(_recover(digest, signature) == reportSigner, "Firma del oraculo invalida");

        uint256 rewardAmount = rewardFor(relayUnits, storeUnits, uptimeUnits, callUnits, reputationUnits);
        require(rewardAmount > 0, "Recompensa cero");
        if (maxRewardPerReport != 0) {
            require(rewardAmount <= maxRewardPerReport, "Recompensa por encima del tope");
        }

        // Efecto antes de la transferencia (checks-effects-interactions).
        processedReports[reportHash] = true;

        _payout(msg.sender, rewardAmount);

        emit RewardPaid(msg.sender, rewardAmount, reportHash);
    }

    /// @dev Paga desde el fondo; si no alcanza y `autoMintTopUp` está activo,
    ///      acuña lo que falta respetando el tope anual. Así el nodo nunca se
    ///      queda sin cobrar, pero la emisión sigue acotada.
    function _payout(address user, uint256 amount) internal {
        uint256 pool = balanceOf[address(this)];
        uint256 fromPool = amount < pool ? amount : pool;
        if (fromPool > 0) {
            _transfer(address(this), user, fromPool);
        }

        uint256 remaining = amount - fromPool;
        if (remaining > 0) {
            require(autoMintTopUp, "Fondo de mineria insuficiente");
            _mintCapped(address(this), remaining);
            _transfer(address(this), user, remaining);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Fondo de minería y economía circular
    // ─────────────────────────────────────────────────────────────

    /// @notice Acuña TTC hacia el fondo de minería. Protegida y acotada por el
    ///         tope anual. Los tokens van SIEMPRE al propio contrato (el fondo).
    function mint(uint256 amount) external onlyMinter returns (uint256) {
        _mintCapped(address(this), amount);
        return amount;
    }

    /// @notice Alias legible de `mint` para quien fondea el pool.
    function fundMiningPool(uint256 amount) external onlyMinter {
        _mintCapped(address(this), amount);
    }

    /// @notice Recarga el fondo de minería con comisiones ya existentes (no se
    ///         acuña nada). Quien llama debe haber aprobado antes esta cantidad.
    ///         Es la pieza de economía circular: menos emisión, misma recompensa.
    function recycleFees(uint256 amount) external {
        require(amount > 0, "Cantidad cero");
        _spendAllowance(msg.sender, address(this), amount);
        _transfer(msg.sender, address(this), amount);
        emit FeesRecycled(msg.sender, amount);
    }

    /// @notice TTC disponibles en el contrato para pagar recompensas.
    function rewardPool() external view returns (uint256) {
        return balanceOf[address(this)];
    }

    // ─────────────────────────────────────────────────────────────
    // ERC-20
    // ─────────────────────────────────────────────────────────────

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function _spendAllowance(address from, address spender, uint256 amount) internal {
        uint256 allowed = allowance[from][spender];
        require(allowed >= amount, "Permiso insuficiente");
        if (allowed != type(uint256).max) {
            allowance[from][spender] = allowed - amount;
        }
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "destino cero");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "Saldo insuficiente");
        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "destino cero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @dev Acuñación sujeta al tope anual. Cuenta por año natural desde el
    ///      despliegue, así que el cupo se renueva solo.
    function _mintCapped(address to, uint256 amount) internal {
        require(amount > 0, "Cantidad cero");
        uint256 year = yearIndex();
        uint256 used = mintedInYear[year];
        require(used + amount <= annualMintCap, "Tope anual de emision alcanzado");
        mintedInYear[year] = used + amount;
        _mint(to, amount);
        emit Minted(to, amount, year);
    }

    // ─────────────────────────────────────────────────────────────
    // Administración (solo el dueño)
    // ─────────────────────────────────────────────────────────────

    function setReportSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "firmante cero");
        emit ReportSignerUpdated(reportSigner, newSigner);
        reportSigner = newSigner;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        minters[minter] = allowed;
        emit MinterUpdated(minter, allowed);
    }

    function setWeights(
        uint256 relay,
        uint256 store,
        uint256 uptime,
        uint256 call,
        uint256 reputation
    ) external onlyOwner {
        relayWeight = relay;
        storeWeight = store;
        uptimeWeight = uptime;
        callWeight = call;
        reputationWeight = reputation;
        emit WeightsUpdated(relay, store, uptime, call, reputation);
    }

    function setHalvingInterval(uint256 newInterval) external onlyOwner {
        require(newInterval > 0, "Intervalo cero");
        emit HalvingIntervalUpdated(halvingInterval, newInterval);
        halvingInterval = newInterval;
    }

    function setRewardFactor(uint256 newFactor) external onlyOwner {
        require(newFactor > 0, "Factor cero");
        emit RewardFactorUpdated(rewardFactor, newFactor);
        rewardFactor = newFactor;
    }

    function setMinRewardFactor(uint256 newFactor) external onlyOwner {
        emit MinRewardFactorUpdated(minRewardFactor, newFactor);
        minRewardFactor = newFactor;
    }

    function setAnnualMintCap(uint256 newCap) external onlyOwner {
        emit AnnualMintCapUpdated(annualMintCap, newCap);
        annualMintCap = newCap;
    }

    function setMaxRewardPerReport(uint256 newMax) external onlyOwner {
        emit MaxRewardUpdated(maxRewardPerReport, newMax);
        maxRewardPerReport = newMax;
    }

    function setAutoMintTopUp(bool enabled) external onlyOwner {
        autoMintTopUp = enabled;
        emit AutoMintTopUpUpdated(enabled);
    }

    function setPaused(bool isPaused) external onlyOwner {
        paused = isPaused;
        emit PausedUpdated(isPaused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "dueno cero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Rescata TTC atrapados en el contrato (distintos del fondo, si
    ///         hicieran falta). No puede tocar el fondo de minería en uso.
    function rescueTokens(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "destino cero");
        _transfer(address(this), to, amount);
        emit TokensRescued(to, amount);
    }

    // ─────────────────────────────────────────────────────────────
    // Firma
    // ─────────────────────────────────────────────────────────────

    /// @dev Recupera el firmante y descarta firmas maleables (s alto, v raro).
    ///      Aplica el prefijo EIP-191 para que la firma sea la estándar de
    ///      personal_sign / signMessage (la que produce ethers.signMessage).
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > _SECP256K1_HALF_N) return address(0);

        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        return ecrecover(ethSigned, v, r, s);
    }
}
