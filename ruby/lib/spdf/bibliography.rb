# frozen_string_literal: true

module Spdf
  # Bibliographic exports: CSL-JSON and BibTeX.
  module Bibliography
    BIBTEX_TYPES = {
      "book" => "book", "article-journal" => "article", "article-magazine" => "article",
      "article-newspaper" => "article", "article" => "article", "chapter" => "incollection",
      "paper-conference" => "inproceedings", "thesis" => "phdthesis", "report" => "techreport",
      "manuscript" => "unpublished", "entry-encyclopedia" => "incollection", "entry-dictionary" => "incollection"
    }.freeze
    FIELDS = {
      "publisher" => "publisher", "publisher-place" => "address", "collection-title" => "series", "volume" => "volume",
      "issue" => "number", "page" => "pages", "edition" => "edition", "DOI" => "doi", "ISBN" => "isbn", "URL" => "url",
      "language" => "language", "abstract" => "abstract", "original-title" => "origtitle"
    }.freeze
    LATEX = { "\\" => "\\textbackslash{}", "{" => "\\{", "}" => "\\}", "&" => "\\&", "%" => "\\%", "$" => "\\$",
              "#" => "\\#", "_" => "\\_", "~" => "\\textasciitilde{}", "^" => "\\textasciicircum{}" }.freeze

    module_function

    # CSL-JSON item with "id"; the "spdf" extension object is dropped unless asked.
    def csl_item(metadata, id, with_extension: false)
      item = { "id" => id }.merge(metadata).merge("id" => id)
      item.delete("spdf") unless with_extension
      item
    end

    def bib_name(p)
      return nil unless p.is_a?(Hash)
      return "{#{p["literal"]}}" if p["literal"]

      family = "#{p["non-dropping-particle"]} #{p["family"]}".strip
      given = "#{p["given"]} #{p["dropping-particle"]}".strip
      return nil if family.empty? && given.empty?
      return given if family.empty?

      given.empty? ? family : "#{family}, #{given}"
    end

    def ascii(s)
      s.to_s.unicode_normalize(:nfkd).gsub(/\p{M}/, "")
       .tr("ßæÆøØœŒłŁ", "sAAoOoOlL").gsub(/[^A-Za-z0-9]/, "")
    end

    def key(item)
      first = %w[author editor].map { |k| item[k].is_a?(Array) ? item[k].first : nil }.compact.first
      who = first.is_a?(Hash) ? (first["family"] || first["literal"] || first["given"]).to_s : ""
      year = item.dig("issued", "date-parts", 0, 0).to_s
      word = Text.words(item["title"].to_s).find { |w| w.length > 3 }.to_s
      k = ascii(who) + year + ascii(word)
      k = ascii(item["id"]) if k.empty?
      k.empty? ? "spdf" : k
    end

    def escape(s) = s.to_s.gsub(/[\\{}&%$#_~^]/) { |c| LATEX[c] }

    def bibtex(item)
      type = BIBTEX_TYPES.fetch(item["type"].to_s, "misc")
      fields = {}
      { "author" => "author", "editor" => "editor", "translator" => "translator" }.each do |csl, bib|
        names = Array(item[csl]).filter_map { |p| bib_name(p) }
        fields[bib] = names.join(" and ") unless names.empty?
      end
      fields["title"] = item["title"].to_s if item["title"]
      container = item["container-title"]
      fields[type == "article" ? "journal" : "booktitle"] = container if container.is_a?(String) && !container.empty?
      parts = item.dig("issued", "date-parts", 0) || []
      fields["year"] = parts[0].to_s if parts[0]
      fields["month"] = parts[1].to_s if parts[1]
      FIELDS.each { |csl, bib| fields[bib] = item[csl].to_s if item[csl] && !item[csl].to_s.empty? && !item[csl].is_a?(Enumerable) }
      fields["school"] = fields.delete("publisher") if type == "phdthesis" && fields["publisher"]
      fields["institution"] = fields.delete("publisher") if type == "techreport" && fields["publisher"]
      fields["pages"] = fields["pages"].gsub(/(?<=\d)\s*[-–]\s*(?=\d)/, "--") if fields["pages"]
      lines = ["@#{type}{#{key(item)},"]
      fields.each { |k, v| lines << "  #{k} = {#{%w[url doi].include?(k) ? v : escape(v)}}," }
      lines << "}"
      "#{lines.join("\n")}\n"
    end
  end
end
