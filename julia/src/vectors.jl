# Little-endian vector blobs: f32, f16 (IEEE binary16) and i8 (value / 127).

const DTYPE_SIZES = Dict("f32" => 4, "f16" => 2, "i8" => 1)

"""
    decode_vector(data::Vector{UInt8}, dtype) -> Vector{Float64}

Components of a stored vector as doubles (f32 and f16 exactly, i8 as q/127).
"""
function decode_vector(data::AbstractVector{UInt8}, dtype::AbstractString = "f32")
    d = Vector{UInt8}(data)
    if dtype == "f32"
        return Float64.(ltoh.(reinterpret(Float32, d)))
    elseif dtype == "f16"
        return Float64.(ltoh.(reinterpret(Float16, d)))
    elseif dtype == "i8"
        return Float64.(reinterpret(Int8, d)) ./ 127
    end
    spdf_error("E032", "unknown dtype $dtype")
end

"""
    quantize(values, dtype) -> Vector{UInt8}

Writer-side encoding: f32 and f16 round to nearest even and refuse values that
overflow; i8 is `clamp(round_half_away(v * 127), -127, 127)`.
"""
function quantize(values, dtype::AbstractString = "f32")
    v = Float64.(collect(values))
    if dtype == "f32"
        f = Float32.(v)
        any(i -> isinf(f[i]) && !isinf(v[i]), eachindex(v)) && spdf_error("E030", "value out of range for f32")
        return collect(reinterpret(UInt8, htol.(f)))
    elseif dtype == "f16"
        f = Float16.(v)
        any(i -> isinf(f[i]) && !isinf(v[i]), eachindex(v)) && spdf_error("E030", "value out of range for f16")
        return collect(reinterpret(UInt8, htol.(f)))
    elseif dtype == "i8"
        q = map(v) do x
            y = x * 127
            abs(y) >= 127 && return Int8(y > 0 ? 127 : -127)   # also catches v * 127 overflowing
            r = floor(abs(y) + 0.5) * (y >= 0 ? 1 : -1)
            Int8(clamp(r, -127, 127))
        end
        return collect(reinterpret(UInt8, q))
    end
    spdf_error("E032", "unknown dtype $dtype")
end

"Packs exact stored values (i8 integers, f16/f32 exact floats) of a conformance source."
function pack_values(values, dtype::AbstractString)
    dtype == "i8" && return collect(reinterpret(UInt8, Int8.(collect(values))))
    dtype == "f16" && return collect(reinterpret(UInt8, htol.(Float16.(Float64.(collect(values))))))
    return collect(reinterpret(UInt8, htol.(Float32.(Float64.(collect(values))))))
end
