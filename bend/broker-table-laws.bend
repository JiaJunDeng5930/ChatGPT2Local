import Base
import ./broker-domain.bend as D
import ./broker-table.bend as M

# Frame laws for finite association lists. The comparison result is explicit:
# these laws do not posit a second, undocumented String equality axiom.
law activity_update_preserves_other_head:
  for id: String
  for value: Bool
  for key: String
  for previous: Bool
  for rest: List<&2, D.Activity>
  for different: {String.eq(id, key) == False{} : Bool}
  {M.activity_put(id, value, Con{D.Activity{key, previous}, rest}) ==
   Con{D.Activity{key, previous}, M.activity_put(id, value, rest)} : List<&2, D.Activity>}

law activity_update_preserves_tail:
  for id: String
  for value: Bool
  for key: String
  for previous: Bool
  for rest: List<&2, D.Activity>
  for same: {String.eq(id, key) == True{} : Bool}
  {M.activity_put(id, value, Con{D.Activity{key, previous}, rest}) ==
   Con{D.Activity{id, value}, rest} : List<&2, D.Activity>}

law invocation_update_preserves_other_head:
  for entry: D.Invocation
  for previous: D.Invocation
  for rest: List<&2, D.Invocation>
  for different: {String.eq(D.invocation_id(entry), D.invocation_id(previous)) == False{} : Bool}
  {M.invocation_put(entry, Con{previous, rest}) ==
   Con{previous, M.invocation_put(entry, rest)} : List<&2, D.Invocation>}

law invocation_update_preserves_tail:
  for entry: D.Invocation
  for previous: D.Invocation
  for rest: List<&2, D.Invocation>
  for same: {String.eq(D.invocation_id(entry), D.invocation_id(previous)) == True{} : Bool}
  {M.invocation_put(entry, Con{previous, rest}) == Con{entry, rest} : List<&2, D.Invocation>}

law deliver_preserves_recorded_result:
  for id: String
  for payload: String
  for digest: String
  for rest: List<&2, D.Invocation>
  {M.deliver_all(Con{D.Invocation{id, payload, D.Result{digest}}, rest}) ==
   Con{D.Invocation{id, payload, D.Result{digest}}, M.deliver_all(rest)} : List<&2, D.Invocation>}

type Content is Data:
  Content{id: String, payload: String}

def contents(entries: List<&2, D.Invocation>) -> List<&2, Content>:
  match entries:
    case Nil{}: Nil{}
    case Con{D.Invocation{id, payload, delivery}, rest}: Con{Content{id, payload}, contents(rest)}

law deliver_preserves_all_identities_and_payloads:
  for entries: List<&2, D.Invocation>
  {contents(M.deliver_all(entries)) == contents(entries) : List<&2, Content>}

law deliver_is_idempotent:
  for entries: List<&2, D.Invocation>
  {M.deliver_all(M.deliver_all(entries)) == M.deliver_all(entries) : List<&2, D.Invocation>}
