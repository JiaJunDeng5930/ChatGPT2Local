import Base

# The daemon's outbound native round is a different owner from the MCP broker:
# this ledger remembers exactly what the HTTP observer may replay.
type Call is Data:
  Call{id: String, payload: String}

type State is Data:
  Outbox{pending: List<&2, Call>, spent: List<&2, String>, prelude: String}

type Event is Data:
  Offer{calls: List<&2, Call>, prelude: String}
  Receipt{id: String}

type Rejection is Data:
  PendingBatch{}
  EmptyBatch{}
  DuplicateCall{}
  UnknownCall{}

type Effect is Data:
  BatchPublished{}
  ReceiptRecorded{}
  Reject{reason: Rejection}

type Decision is Data:
  Decision{state: State, effect: Effect}

def state(decision: Decision) -> State:
  match decision:
    case Decision{state, effect}: state

def member(+id: String, ids: List<&2, String>) -> Bool:
  match ids:
    case Nil{}: False{}
    case Con{head, rest}: Bool.or(String.eq(id, head), member(id, rest))

def names(calls: List<&2, Call>) -> List<&2, String>:
  match calls:
    case Nil{}: Nil{}
    case Con{Call{id, payload}, rest}: Con{id, names(rest)}

def fresh(calls: List<&2, Call>, +seen: List<&2, String>) -> Bool:
  match calls:
    case Nil{}: True{}
    case Con{Call{+id, payload}, rest}:
      Bool.and(Bool.not(member(id, seen)), fresh(rest, Con{id, seen}))

def nonempty(calls: List<&2, Call>) -> Bool:
  match calls:
    case Nil{}: False{}
    case Con{head, tail}: True{}

def keep(different: Bool, call: Call, rest: List<&2, Call>) -> List<&2, Call>:
  match different:
    case True{}: Con{call, rest}
    case False{}: rest

def without(+id: String, calls: List<&2, Call>) -> List<&2, Call>:
  match calls:
    case Nil{}: Nil{}
    case Con{Call{+key, payload}, rest}: keep(Bool.not(String.eq(id, key)), Call{key, payload}, without(id, rest))

def prelude_for(pending: List<&2, Call>, prelude: String) -> String:
  match pending:
    case Nil{}: ""
    case Con{head, tail}: prelude

def pending(state: State) -> List<&2, Call>:
  match state:
    case Outbox{pending, spent, prelude}: pending

def prelude(state: State) -> String:
  match state:
    case Outbox{pending, spent, prelude}: prelude
