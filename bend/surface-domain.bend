import Base
type Evidence is Data:
  Evidence{present: Bool, untouched: Bool, idle: Bool, assistant_tail: Bool,
           recorded_key: String, key: String,
           recorded_operation: String, operation: String,
           recorded_answer: String, expected_answer: String, answer: String}
