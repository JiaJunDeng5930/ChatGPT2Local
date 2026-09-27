import Base

# Optional native adaptive reasoning is a different protocol from a retained
# webpage. Its two chargeable effects also need one durable owner each.
type Effort is Data:
  NoReasoning{}
  Minimal{}
  Low{}
  Medium{}
  High{}
  ExtraHigh{}
  Maximum{}
  Ultra{}

type Phase is Data:
  Unchosen{}
  Choosing{}
  Sending{effort: Effort}
  Finished{receipt: String}
  Unknown{}

type Event is Data:
  Begin{lease: Maybe<&2, Effort>}
  Advice{effort: Effort}
  Complete{receipt: String}
  Recover{}
  Lost{}
  Poll{}

type Effect is Data:
  Classify{}
  Forward{effort: Effort}
  Receipt{body: String}
  Wait{}
  NeedsAttention{}

type Decision is Data:
  Decision{phase: Phase, effect: Effect}

type Cache is Data:
  Empty{}
  Lease{environment: String, history: List<&2, String>, effort: Effort, remaining: Nat}

type Choice is Data:
  Choice{cache: Cache, effort: Maybe<&2, Effort>}

def phase(d: Decision) -> Phase:
  match d:
    case Decision{s, e}: s

def effect(d: Decision) -> Effect:
  match d:
    case Decision{s, e}: e

def calls(e: Effect) -> Nat:
  match e:
    case Forward{effort}: 1n
    case _: 0n

def name(e: Effort) -> String:
  match e:
    case NoReasoning{}: "none"
    case Minimal{}: "minimal"
    case Low{}: "low"
    case Medium{}: "medium"
    case High{}: "high"
    case ExtraHigh{}: "xhigh"
    case Maximum{}: "max"
    case Ultra{}: "ultra"

def pick(equal: Bool, effort: Effort, rest: Maybe<&2, Effort>) -> Maybe<&2, Effort>:
  match equal:
    case True{}: Some{effort}
    case False{}: rest

def decode(+text: String) -> Maybe<&2, Effort>:
  pick(String.eq(text, "none"), NoReasoning{},
    pick(String.eq(text, "minimal"), Minimal{},
      pick(String.eq(text, "low"), Low{},
        pick(String.eq(text, "medium"), Medium{},
          pick(String.eq(text, "high"), High{},
            pick(String.eq(text, "xhigh"), ExtraHigh{},
              pick(String.eq(text, "max"), Maximum{},
                pick(String.eq(text, "ultra"), Ultra{}, None{}))))))))

def valid_lease(n: Nat) -> Bool:
  match n:
    case 1n: True{}
    case 2n: True{}
    case 5n: True{}
    case 10n: True{}
    case _: False{}

def install(valid: Bool, environment: String, history: List<&2, String>, effort: Effort, steps: Nat) -> Cache:
  match valid steps:
    case True{} 1n+remaining: Lease{environment, history, effort, remaining}
    case _ _: Empty{}
