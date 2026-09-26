import Base
import ./broker-domain.bend as D
import ./broker-table.bend as M
import ./broker-table-laws.bend as L

def L.activity_update_preserves_other_head(id, value, key, previous, rest, different):
  %Equal.sym(Bool, String.eq(id, key), False{}, different) :
    {M.activity_cons(_, D.Activity{id, value}, D.Activity{key, previous}, rest,
      M.activity_put(id, value, rest)) == Con{D.Activity{key, previous}, M.activity_put(id, value, rest)} : List<&2, D.Activity>}
  {==}

def L.activity_update_preserves_tail(id, value, key, previous, rest, same):
  %Equal.sym(Bool, String.eq(id, key), True{}, same) :
    {M.activity_cons(_, D.Activity{id, value}, D.Activity{key, previous}, rest,
      M.activity_put(id, value, rest)) == Con{D.Activity{id, value}, rest} : List<&2, D.Activity>}
  {==}

def L.invocation_update_preserves_other_head(entry, previous, rest, different):
  %Equal.sym(Bool, String.eq(D.invocation_id(entry), D.invocation_id(previous)), False{}, different) :
    {M.invocation_cons(_, entry, previous, rest, M.invocation_put(entry, rest)) ==
     Con{previous, M.invocation_put(entry, rest)} : List<&2, D.Invocation>}
  {==}

def L.invocation_update_preserves_tail(entry, previous, rest, same):
  %Equal.sym(Bool, String.eq(D.invocation_id(entry), D.invocation_id(previous)), True{}, same) :
    {M.invocation_cons(_, entry, previous, rest, M.invocation_put(entry, rest)) == Con{entry, rest} : List<&2, D.Invocation>}
  {==}

def L.deliver_preserves_recorded_result(id, payload, digest, rest):
  {==}

def L.deliver_preserves_all_identities_and_payloads(entries):
  match entries:
    case Nil{}: {==}
    case Con{D.Invocation{id, payload, delivery}, +rest}:
      %L.deliver_preserves_all_identities_and_payloads(rest) :
        {Con{L.Content{id, payload}, L.contents(M.deliver_all(rest))} == Con{L.Content{id, payload}, _} : List<&2, L.Content>}
      {==}

def delivery_idempotent(delivery: D.Delivery) ->
  {M.deliver(M.deliver(delivery)) == M.deliver(delivery) : D.Delivery}:
  match delivery:
    case D.Queued{}: {==}
    case D.Delivered{}: {==}
    case D.Result{digest}: {==}

def L.deliver_is_idempotent(entries):
  match entries:
    case Nil{}: {==}
    case Con{D.Invocation{id, payload, +delivery}, +rest}:
      %Equal.sym(D.Delivery, M.deliver(M.deliver(delivery)), M.deliver(delivery), delivery_idempotent(delivery)) :
        {Con{D.Invocation{id, payload, _}, M.deliver_all(M.deliver_all(rest))} ==
         Con{D.Invocation{id, payload, M.deliver(delivery)}, M.deliver_all(rest)} : List<&2, D.Invocation>}
      %Equal.sym(List<&2, D.Invocation>, M.deliver_all(M.deliver_all(rest)), M.deliver_all(rest), L.deliver_is_idempotent(rest)) :
        {Con{D.Invocation{id, payload, M.deliver(delivery)}, _} ==
         Con{D.Invocation{id, payload, M.deliver(delivery)}, M.deliver_all(rest)} : List<&2, D.Invocation>}
      {==}
