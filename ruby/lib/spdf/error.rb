# frozen_string_literal: true

module Spdf
  # Any failure while opening, reading or writing a SPDF file. +code+ is the
  # validation code of the specification (E001, E002, E020, E060…).
  class Error < StandardError
    attr_reader :code

    def initialize(code, message)
      @code = code
      super("[#{code}] #{message}")
    end
  end
end
