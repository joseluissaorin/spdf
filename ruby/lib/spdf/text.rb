# frozen_string_literal: true

module Spdf
  # Unicode helpers and the reference query parser (specification §6).
  module Text
    QUOTES = { '"' => ['"'], "“" => ["”"], "«" => ["»"], "„" => ["“", "”"] }.freeze
    CJK = /[\u{2E80}-\u{2FDF}\u{3040}-\u{30FF}\u{3100}-\u{312F}\u{3130}-\u{318F}\u{31A0}-\u{31FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A960}-\u{A97F}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FF66}-\u{FF9F}\u{20000}-\u{3FFFF}]/

    module_function

    def nfc(s)
      s.unicode_normalize(:nfc)
    rescue ArgumentError, Encoding::CompatibilityError
      s
    end

    def words(s)
      s.scan(/[\p{L}\p{M}\p{N}]+/)
    end

    def dedup_key(t)
      t.unicode_normalize(:nfd).gsub(/\p{Mn}/, "").downcase
    end

    def cjk?(s)
      CJK.match?(s)
    end

    def fts_string(t)
      "\"#{t.gsub('"', '""')}\""
    end

    # Terms of a user query: [terms, phrases?, cjk?].
    def query_terms(query)
      q = nfc(query.to_s)
      chars = q.chars
      phrases = []
      rest = +""
      i = 0
      while i < chars.length
        c = chars[i]
        if QUOTES.key?(c)
          j = ((i + 1)...chars.length).find { |k| QUOTES[c].include?(chars[k]) }
          rest << " "
          if j
            phrases << chars[(i + 1)...j].join
            i = j + 1
          else
            i += 1
          end
          next
        end
        rest << c
        i += 1
      end
      phrase_terms = phrases.map { |p| words(p) }.reject(&:empty?).map { |w| w.join(" ") }
      candidates = phrase_terms.empty? ? words(rest) : phrase_terms
      seen = {}
      terms = candidates.select { |t| seen[dedup_key(t)] ? false : (seen[dedup_key(t)] = true) }
      [terms, !phrase_terms.empty?, cjk?(q)]
    end

    def fts_match(terms, phrases)
      return nil if terms.empty?

      terms.map { |t| fts_string(t) }.join(phrases ? " AND " : " OR ")
    end
  end
end
