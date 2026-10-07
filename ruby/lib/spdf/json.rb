# frozen_string_literal: true

require "json"

module Spdf
  # Canonical JSON: RFC 8785 (JCS) after rounding non-integer numbers to 6 decimals.
  module Json
    module_function

    def parse(text)
      ::JSON.parse(text, max_nesting: 512)
    end

    # Parses a JSON-in-TEXT column; nil stays nil, invalid JSON stays the raw string.
    def column(text)
      return nil if text.nil?

      ::JSON.parse(text)
    rescue ::JSON::ParserError
      text
    end

    def generate(value, pretty: false)
      pretty ? ::JSON.pretty_generate(value) : ::JSON.generate(value)
    end

    # Rounds to 6 decimals, half to even on the exact binary value; -0 becomes 0.
    def round6(x)
      return x unless x.finite?

      r = format("%.6f", x).to_f
      r.zero? ? 0.0 : r
    end

    # ECMAScript Number::toString of a finite float.
    def ecma(x)
      return "0" if x.zero?

      repr = x.abs.to_s # shortest round-trip digits
      m = repr.match(/\A(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?\z/)
      return repr unless m

      int = m[1]
      frac = m[2] || ""
      exp = m[3] ? m[3].to_i : 0
      digits = int + frac
      n = int.length + exp
      lead = digits[/\A0*/].length
      digits = digits[lead..]
      n -= lead
      digits = digits.sub(/0+\z/, "")
      return "0" if digits.empty?

      k = digits.length
      sign = x.negative? ? "-" : ""
      body =
        if k <= n && n <= 21
          digits + ("0" * (n - k))
        elsif n.positive? && n <= 21
          "#{digits[0, n]}.#{digits[n..]}"
        elsif -6 < n && n <= 0
          "0.#{"0" * -n}#{digits}"
        else
          e = n - 1
          mant = k > 1 ? "#{digits[0]}.#{digits[1..]}" : digits
          "#{mant}e#{e.negative? ? "-" : "+"}#{e.abs}"
        end
      sign + body
    end

    def number(x)
      return x.to_s if x.is_a?(Integer)
      raise Error.new("E000", "NaN and infinities are not JSON") unless x.finite?

      ecma(round6(x))
    end

    def string(s)
      out = +'"'
      s.each_char do |c|
        o = c.ord
        out << case c
               when '"' then '\\"'
               when "\\" then "\\\\"
               when "\b" then "\\b"
               when "\f" then "\\f"
               when "\n" then "\\n"
               when "\r" then "\\r"
               when "\t" then "\\t"
               else o < 0x20 ? format("\\u%04x", o) : c
               end
      end
      out << '"'
    end

    # RFC 8785 serialization (keys sorted by UTF-16 code units).
    def canonical(value)
      case value
      when nil then "null"
      when true then "true"
      when false then "false"
      when Integer, Float then number(value)
      when String then string(value)
      when Symbol then string(value.to_s)
      when Array then "[#{value.map { |v| canonical(v) }.join(",")}]"
      when Hash
        keys = value.keys.map(&:to_s).sort_by { |k| k.encode("UTF-16BE").bytes }
        lookup = value.transform_keys(&:to_s)
        "{#{keys.map { |k| "#{string(k)}:#{canonical(lookup[k])}" }.join(",")}}"
      else
        raise ArgumentError, "not JSON: #{value.class}"
      end
    end

    # Rounds every float in a tree (integral results become integers).
    def canon(value)
      case value
      when Float
        r = round6(value)
        r == r.floor && r.abs < 2**53 ? r.to_i : r
      when Array then value.map { |v| canon(v) }
      when Hash then value.to_h { |k, v| [k, canon(v)] }
      else value
      end
    end
  end
end
