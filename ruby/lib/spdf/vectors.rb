# frozen_string_literal: true

module Spdf
  # Little-endian vector blobs: f32, f16 (IEEE binary16) and i8 (value / 127).
  module Vectors
    SIZES = { "f32" => 4, "f16" => 2, "i8" => 1 }.freeze

    module_function

    def size(dtype)
      SIZES.fetch(dtype) { raise Error.new("E032", "unknown dtype #{dtype}") }
    end

    def decode(blob, dtype = "f32")
      case dtype
      when "f32" then blob.unpack("e*")
      when "f16" then blob.unpack("v*").map { |h| half_to_float(h) }
      when "i8" then blob.unpack("c*").map { |q| q / 127.0 }
      else raise Error.new("E032", "unknown dtype #{dtype}")
      end
    end

    # Encodes floats; i8 quantizes as clamp(round_half_away(v * 127), -127, 127).
    def encode(values, dtype = "f32")
      case dtype
      when "f32" then values.map(&:to_f).pack("e*")
      when "f16" then values.map { |v| float_to_half(v.to_f) }.pack("v*")
      when "i8" then values.map { |v| (v.to_f * 127).round.clamp(-127, 127) }.pack("c*")
      else raise Error.new("E032", "unknown dtype #{dtype}")
      end
    end

    def half_to_float(h)
      sign = (h >> 15) & 1 == 1 ? -1.0 : 1.0
      exp = (h >> 10) & 0x1f
      frac = h & 0x3ff
      return sign * frac * (2.0**-24) if exp.zero?
      return frac.zero? ? sign * Float::INFINITY : Float::NAN if exp == 31

      sign * (1 + (frac / 1024.0)) * (2.0**(exp - 15))
    end

    def float_to_half(f)
      bits = [f].pack("e").unpack1("V")
      sign = (bits >> 16) & 0x8000
      raw_exp = (bits >> 23) & 0xff
      mant = bits & 0x7fffff
      return sign | 0x7c00 | (mant.zero? ? 0 : 0x200) if raw_exp == 0xff

      exp = raw_exp - 127 + 15
      return sign | 0x7c00 if exp >= 31

      if exp <= 0
        return sign if exp < -10

        mant |= 0x800000
        shift = 14 - exp
        half = mant >> shift
        rem = mant & ((1 << shift) - 1)
        mid = 1 << (shift - 1)
        half += 1 if rem > mid || (rem == mid && half.odd?)
        return sign | half
      end
      half = (exp << 10) | (mant >> 13)
      rem = mant & 0x1fff
      half += 1 if rem > 0x1000 || (rem == 0x1000 && half.odd?)
      sign | half
    end

    def dot(a, b)
      s = 0.0
      a.each_with_index { |x, i| s += x.to_f * b[i] if i < b.length }
      s
    end

    def cosine(a, b)
      na = Math.sqrt(a.sum { |x| x.to_f * x })
      nb = Math.sqrt(b.sum { |x| x * x })
      return 0.0 if na.zero? || nb.zero?

      dot(a, b) / (na * nb)
    end
  end
end
