# frozen_string_literal: true

# SPDF (Semantic Processed Document Format): documents read once and citable forever.
#
#   doc = Spdf::Document.open("lazarillo.spdf")
#   doc.search_lexical("molinos de viento", limit: 5).each do |hit|
#     puts doc.cite(hit["anchor"], locale: "es")
#   end
module Spdf
end

require_relative "spdf/version"
require_relative "spdf/error"
require_relative "spdf/json"
require_relative "spdf/text"
require_relative "spdf/vectors"
require_relative "spdf/container"
require_relative "spdf/legacy"
require_relative "spdf/anchor_uri"
require_relative "spdf/cite"
require_relative "spdf/bibliography"
require_relative "spdf/document"
require_relative "spdf/search"
require_relative "spdf/interop"
require_relative "spdf/validator"
require_relative "spdf/writer"
require_relative "spdf/conformance"
