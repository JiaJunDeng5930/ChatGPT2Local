import Base
import ./broker-domain.bend as D

# Finite association lists. A put replaces rather than duplicates its key.
# These are data-structure operations, with no knowledge of owner lifetimes or
# whether a particular application operation is authorized.
def activity_choice(matches: Bool, value: Bool, rest: Maybe<&2, Bool>) -> Maybe<&2, Bool>:
  match matches:
    case True{}: Some{value}
    case False{}: rest

def activity_get(+id: String, entries: List<&2, D.Activity>) -> Maybe<&2, Bool>:
  match entries:
    case Nil{}: None{}
    case Con{D.Activity{key, value}, rest}:
      activity_choice(String.eq(id, key), value, activity_get(id, rest))

def activity_cons(matches: Bool, replacement: D.Activity, previous: D.Activity,
                  rest: List<&2, D.Activity>, updated: List<&2, D.Activity>) -> List<&2, D.Activity>:
  match matches:
    case True{}: Con{replacement, rest}
    case False{}: Con{previous, updated}

def activity_put(+id: String, +completed: Bool, entries: List<&2, D.Activity>) -> List<&2, D.Activity>:
  match entries:
    case Nil{}: Con{D.Activity{id, completed}, Nil{}}
    case Con{D.Activity{+key, previous}, +rest}:
      activity_cons(String.eq(id, key), D.Activity{id, completed}, D.Activity{key, previous}, rest,
        activity_put(id, completed, rest))

def active(completed: Bool, rest: Bool) -> Bool:
  match completed:
    case False{}: True{}
    case True{}: rest

def has_activity(entries: List<&2, D.Activity>) -> Bool:
  match entries:
    case Nil{}: False{}
    case Con{D.Activity{id, completed}, rest}: active(completed, has_activity(rest))

def invocation_choice(matches: Bool, value: D.Invocation, rest: Maybe<&2, D.Invocation>) -> Maybe<&2, D.Invocation>:
  match matches:
    case True{}: Some{value}
    case False{}: rest

def invocation_get(+id: String, entries: List<&2, D.Invocation>) -> Maybe<&2, D.Invocation>:
  match entries:
    case Nil{}: None{}
    case Con{D.Invocation{+key, payload, delivery}, rest}:
      invocation_choice(String.eq(id, key), D.Invocation{key, payload, delivery}, invocation_get(id, rest))

def invocation_cons(matches: Bool, replacement: D.Invocation, previous: D.Invocation,
                    rest: List<&2, D.Invocation>, updated: List<&2, D.Invocation>) -> List<&2, D.Invocation>:
  match matches:
    case True{}: Con{replacement, rest}
    case False{}: Con{previous, updated}

def invocation_put(+entry: D.Invocation, entries: List<&2, D.Invocation>) -> List<&2, D.Invocation>:
  match entries:
    case Nil{}: Con{entry, Nil{}}
    case Con{+previous, +rest}:
      invocation_cons(String.eq(D.invocation_id(entry), D.invocation_id(previous)), entry, previous, rest,
        invocation_put(entry, rest))

def pending(delivery: D.Delivery) -> Bool:
  match delivery:
    case D.Queued{}: True{}
    case D.Delivered{}: True{}
    case D.Result{digest}: False{}

def has_invocation(entries: List<&2, D.Invocation>) -> Bool:
  match entries:
    case Nil{}: False{}
    case Con{D.Invocation{id, payload, delivery}, rest}:
      Bool.or(pending(delivery), has_invocation(rest))

def select_delivered(delivery: D.Delivery, id: String, rest: List<&2, String>) -> List<&2, String>:
  match delivery:
    case D.Queued{}: rest
    case D.Delivered{}: Con{id, rest}
    case D.Result{digest}: rest

def delivered(entries: List<&2, D.Invocation>) -> List<&2, String>:
  match entries:
    case Nil{}: Nil{}
    case Con{D.Invocation{id, payload, delivery}, rest}: select_delivered(delivery, id, delivered(rest))

def select_queued(delivery: D.Delivery, id: String, rest: List<&2, String>) -> List<&2, String>:
  match delivery:
    case D.Queued{}: Con{id, rest}
    case D.Delivered{}: rest
    case D.Result{digest}: rest

def queued(entries: List<&2, D.Invocation>) -> List<&2, String>:
  match entries:
    case Nil{}: Nil{}
    case Con{D.Invocation{id, payload, delivery}, rest}: select_queued(delivery, id, queued(rest))

def deliver(delivery: D.Delivery) -> D.Delivery:
  match delivery:
    case D.Queued{}: D.Delivered{}
    case D.Delivered{}: D.Delivered{}
    case D.Result{digest}: D.Result{digest}

def deliver_all(entries: List<&2, D.Invocation>) -> List<&2, D.Invocation>:
  match entries:
    case Nil{}: Nil{}
    case Con{D.Invocation{id, payload, delivery}, rest}:
      Con{D.Invocation{id, payload, deliver(delivery)}, deliver_all(rest)}

def busy(s: D.State) -> Bool:
  match s:
    case D.Broker{lifetime, environment, revision, activities, invocations}:
      Bool.or(has_activity(activities), has_invocation(invocations))
