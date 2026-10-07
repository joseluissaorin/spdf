# frozen_string_literal: true

module Spdf
  # Bibliographic exports (specification §19): CSL-JSON and BibTeX.
  #
  # CSL-JSON: the metadata item without its "spdf" member, "id" = BibTeX key.
  # BibTeX key: first author's family name (or the first word of the title) folded to
  # ASCII letters and lowercased, plus the year (or "nd"); collisions inside one export
  # get a, b, c... Exports never invent data.
  module Bibliography
    TYPES = {
      "book" => "book", "article-journal" => "article", "article-magazine" => "article",
      "article-newspaper" => "article", "chapter" => "incollection", "paper-conference" => "inproceedings",
      "thesis" => "phdthesis", "report" => "techreport"
    }.freeze
    FIELDS = [%w[publisher publisher], %w[publisher-place address], %w[collection-title series], %w[volume volume],
              %w[issue number], %w[page pages], %w[edition edition], %w[DOI doi], %w[ISBN isbn], %w[URL url],
              %w[language language], %w[note note]].freeze
    ESCAPES = { "\\" => "\\textbackslash{}", "{" => "\\{", "}" => "\\}" }.freeze

    module_function

    def base(metadata) = metadata.reject { |k, _| k == "spdf" }

    # CSL item without "spdf", with "id" = BibTeX key.
    def csl_item(metadata)
      item = base(metadata)
      item.merge("id" => key(item))
    end

    def csl_items(metadatas)
      items = metadatas.map { |m| base(m) }
      items.zip(keys(items)).map { |it, k| it.merge("id" => k) }
    end

    def ascii_letters(s)
      s.to_s.unicode_normalize(:nfkd).gsub(/\p{Mn}/, "").gsub(/[^A-Za-z]/, "").downcase
    end

    def year(item)
      y = item.dig("issued", "date-parts", 0, 0) if item["issued"].is_a?(Hash) && item["issued"]["date-parts"].is_a?(Array) &&
                                                   item["issued"]["date-parts"][0].is_a?(Array)
      return nil if y.nil? || y == true || y == false
      return y.to_i.to_s if y.is_a?(Integer) || (y.is_a?(Float) && y == y.floor)
      return y.strip.to_i.to_s if y.is_a?(String) && y.match?(/\A\s*-?\d+\s*\z/)

      nil
    end

    def key(item)
      base = ""
      a = item["author"].is_a?(Array) ? item["author"][0] : nil
      if a.is_a?(Hash)
        who = [a["family"], a["literal"]].find { |x| x && x != "" } || ""
        base = ascii_letters(who)
      end
      if base.empty?
        w = item["title"].to_s.split.first
        base = w ? ascii_letters(w) : ""
      end
      (base.empty? ? "anon" : base) + (year(item) || "nd")
    end

    def suffix(n)
      letters = +""
      n += 1
      while n.positive?
        n, r = (n - 1).divmod(26)
        letters.prepend((97 + r).chr)
      end
      letters
    end

    def keys(items)
      bases = items.map { |it| key(it) }
      counts = bases.tally
      seen = Hash.new(0)
      bases.map do |b|
        next b if counts[b] == 1

        n = seen[b]
        seen[b] += 1
        b + suffix(n)
      end
    end

    def escape(s) = s.to_s.gsub(/[\\{}]/) { |c| ESCAPES[c] }

    def protect_title(t)
      t.to_s.split(/(\s+)/).map { |tok| tok.match?(/\p{Lu}/) ? "{#{escape(tok)}}" : escape(tok) }.join
    end

    def names(people)
      return nil unless people.is_a?(Array)

      out = people.filter_map do |p|
        next unless p.is_a?(Hash)
        next "{#{escape(p["literal"])}}" if p["literal"] && p["literal"] != ""

        family = p["family"].to_s
        particle = p["non-dropping-particle"].to_s
        family = "#{particle} #{family}" if !particle.empty? && !family.empty?
        given = p["given"].to_s
        if !family.empty? && !given.empty?
          "#{escape(family)}, #{escape(given)}"
        elsif !family.empty? || !given.empty?
          "{#{escape(family.empty? ? given : family)}}"
        end
      end
      out.empty? ? nil : out.join(" and ")
    end

    def scalar_text(v)
      return(v ? "True" : "False") if v == true || v == false
      return v.to_s if v.is_a?(Float) && v != v.floor

      v.is_a?(Float) ? format("%.1f", v) : v.to_s
    end

    # One BibTeX entry of a CSL item.
    def bibtex(item, key = nil)
      entry = TYPES.fetch(item["type"].to_s, "misc")
      fields = []
      (a = names(item["author"])) && fields << ["author", a]
      (e = names(item["editor"])) && fields << ["editor", e]
      fields << ["title", protect_title(item["title"])] if item["title"] && item["title"] != ""
      (y = year(item)) && fields << ["year", y]
      ct = item["container-title"]
      fields << [entry == "article" ? "journal" : "booktitle", protect_title(ct)] if ct && ct != ""
      FIELDS.each do |csl, bib|
        v = item[csl]
        next if v.nil? || v == "" || v == []

        fields << [bib, escape(v.is_a?(Hash) || v.is_a?(Array) ? JSON.generate(v) : scalar_text(v))]
      end
      "@#{entry}{#{key || key(item)},\n#{fields.map { |k, v| "  #{k} = {#{v}}" }.join(",\n")}\n}\n"
    end

    # BibTeX of several metadata records (keys disambiguated with a, b, c...).
    def bibtex_all(metadatas)
      items = metadatas.map { |m| base(m) }
      items.zip(keys(items)).map { |it, k| bibtex(it, k) }.join("\n")
    end
  end
end
