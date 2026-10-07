# Ed25519 signature verification (RFC 8032, section 5.1), pure Julia with BigInt.
# Verification only: it handles public data and needs no constant-time arithmetic.

module Ed25519

using SHA

const P = big(2)^255 - 19
const L = big(2)^252 + big"27742317777372353535851937790883648493"
const D = mod(-121665 * invmod(big(121666), P), P)
const SQRT_M1 = powermod(big(2), (P - 1) ÷ 4, P)

le_int(b::AbstractVector{UInt8}) = foldr((x, acc) -> acc * 256 + x, b; init = big(0))

function add(Pt, Q)
    a = mod((Pt[2] - Pt[1]) * (Q[2] - Q[1]), P)
    b = mod((Pt[2] + Pt[1]) * (Q[2] + Q[1]), P)
    c = mod(2 * Pt[4] * Q[4] * D, P)
    d = mod(2 * Pt[3] * Q[3], P)
    e, f, g, h = b - a, d - c, d + c, b + a
    return (mod(e * f, P), mod(g * h, P), mod(f * g, P), mod(e * h, P))
end

function mul(s::BigInt, Pt)
    Q = (big(0), big(1), big(1), big(0))
    while s > 0
        if isodd(s)
            Q = add(Q, Pt)
        end
        Pt = add(Pt, Pt)
        s >>= 1
    end
    return Q
end

equal(Pt, Q) = mod(Pt[1] * Q[3] - Q[1] * Pt[3], P) == 0 && mod(Pt[2] * Q[3] - Q[2] * Pt[3], P) == 0

function recover_x(y::BigInt, sign::Integer)
    y >= P && return nothing
    x2 = mod((y * y - 1) * invmod(mod(D * y * y + 1, P), P), P)
    x2 == 0 && return sign != 0 ? nothing : big(0)
    x = powermod(x2, (P + 3) ÷ 8, P)
    if mod(x * x - x2, P) != 0
        x = mod(x * SQRT_M1, P)
    end
    mod(x * x - x2, P) != 0 && return nothing
    if (x & 1) != sign
        x = P - x
    end
    return x
end

const GY = mod(4 * invmod(big(5), P), P)
const GX = recover_x(GY, 0)
const G = (GX, GY, big(1), mod(GX * GY, P))

function decompress(s::AbstractVector{UInt8})
    length(s) == 32 || return nothing
    y = le_int(s)
    sign = Int(y >> 255)
    y &= (big(1) << 255) - 1
    x = recover_x(y, sign)
    x === nothing && return nothing
    return (x, y, big(1), mod(x * y, P))
end

"verify(public_key, message, signature) -> Bool"
function verify(pk::AbstractVector{UInt8}, msg::AbstractVector{UInt8}, sig::AbstractVector{UInt8})
    (length(pk) == 32 && length(sig) == 64) || return false
    A = decompress(pk)
    A === nothing && return false
    R = decompress(sig[1:32])
    R === nothing && return false
    s = le_int(sig[33:64])
    s >= L && return false
    h = mod(le_int(sha512(vcat(sig[1:32], pk, msg))), L)
    return equal(mul(s, G), add(R, mul(h, A)))
end

end # module Ed25519
