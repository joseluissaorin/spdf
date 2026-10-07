# frozen_string_literal: true

require_relative "test_helper"

class TestConformance < Minitest::Test
  DIR = File.expand_path("../../conformance", __dir__)

  def test_suite
    skip "no conformance cases in #{DIR}" if Dir[File.join(DIR, "cases", "*.json")].empty?
    r = Spdf::Conformance.new(DIR).run
    assert_empty r["failed"], JSON.pretty_generate(r["failed"])
  end
end
