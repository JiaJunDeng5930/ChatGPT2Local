import Base
import ./history.bend as H
import ./history-specification.bend as S
import ./LAWS.bend as L
import ./history-laws.bend as HL
import ./history-domain.bend as D

def bump_choose(a: Bool, b: Bool, n: Nat) ->
  {H.bump(a, S.choose(b, n)) == S.choose(Bool.and(a, b), 1n+n) : Maybe<&2, Nat>}:
  match a b:
    case False{} False{}: {==}
    case False{} True{}: {==}
    case True{} False{}: {==}
    case True{} True{}: {==}

def L.history_refinement(known, incoming):
  match known incoming:
    case Nil{} _: {==}
    case Con{h, t} Nil{}: {==}
    case Con{+h, +t} Con{+a, +b}:
      %bump_choose(String.eq(h, a), S.prefix(t, b), List.length(&2, String, t)) :
        {H.bump(String.eq(h, a), H.reconcile(t, b)) == _ : Maybe<&2, Nat>}
      %L.history_refinement(t, b) :
        {H.bump(String.eq(h, a), H.reconcile(t, b)) == H.bump(String.eq(h, a), _) : Maybe<&2, Nat>}
      {==}

def envelope_choose(environment: Bool, prefix: Bool, n: Nat) ->
  {H.with_envelope(environment, S.choose(prefix, n)) == S.choose(Bool.and(environment, prefix), n) : Maybe<&2, Nat>}:
  match environment prefix:
    case False{} False{}: {==}
    case False{} True{}: {==}
    case True{} False{}: {==}
    case True{} True{}: {==}

def HL.plan_refinement(old_environment, environment, known, incoming):
  +old = old_environment
  +env = environment
  +before = known
  +after = incoming
  %envelope_choose(String.eq(old, env), S.prefix(before, after), List.length(&2, String, before)) :
    {H.with_envelope(String.eq(old, env), H.reconcile(before, after)) == _ : Maybe<&2, Nat>}
  %L.history_refinement(before, after) :
    {H.with_envelope(String.eq(old, env), H.reconcile(before, after)) == H.with_envelope(String.eq(old, env), _) : Maybe<&2, Nat>}
  {==}

def admission_refinement(valid: Bool, key: String, n: Nat) ->
  {H.eligible(valid, key, n) == S.admit(valid, key, n) : D.Selection}:
  match valid:
    case False{}: {==}
    case True{}: {==}

def candidate_allowed(environment: Bool, prefix: Bool, key: String, +n: Nat, length: Nat) ->
  {H.candidate(S.choose(Bool.and(environment, prefix), n), key, length) ==
   S.allowed(environment, prefix, key, n, length) : D.Selection}:
  match environment prefix:
    case False{} False{}: {==}
    case False{} True{}: {==}
    case True{} False{}: {==}
    case True{} True{}:
      admission_refinement(Bool.and(Nat.is_gt(n, 0n), Nat.is_lt(n, length)), key, n)

def rank_refinement(longer: Bool, equal: Bool, earlier: Bool, a: D.Selection, b: D.Selection) ->
  {H.prefer(Bool.or(longer, Bool.and(equal, earlier)), a, b) == S.rank(longer, equal, earlier, a, b) : D.Selection}:
  match longer equal earlier:
    case True{} _ _: {==}
    case False{} True{} True{}: {==}
    case False{} True{} False{}: {==}
    case False{} False{} _: {==}

def longer_refinement(a: D.Selection, b: D.Selection) ->
  {H.longer(a, b) == S.best(a, b) : D.Selection}:
  match a b:
    case D.NewConversation{} _: {==}
    case D.ReuseConversation{k, n} D.NewConversation{}: {==}
    case D.ReuseConversation{+ka, +na} D.ReuseConversation{+kb, +nb}:
      rank_refinement(Nat.is_gt(na, nb), Nat.is_eq(na, nb), String.is_le(ka, kb),
        D.ReuseConversation{ka, na}, D.ReuseConversation{kb, nb})

def HL.selection_refinement(receipts, environment, incoming, length):
  match receipts:
    case Nil{}: {==}
    case Con{D.Receipt{+key, +old_environment, +known}, +rest}:
      +env = environment
      +messages = incoming
      +count = length
      %Equal.sym(Maybe<&2, Nat>, H.plan(old_environment, env, known, messages), S.plan(old_environment, env, known, messages),
        HL.plan_refinement(old_environment, env, known, messages)) :
        {H.longer(H.candidate(_, key, count), H.select(rest, env, messages, count)) ==
         S.select(Con{D.Receipt{key, old_environment, known}, rest}, env, messages, count) : D.Selection}
      %Equal.sym(D.Selection,
        H.candidate(S.plan(old_environment, env, known, messages), key, count),
        S.allowed(String.eq(old_environment, env), S.prefix(known, messages), key, List.length(&2, String, known), count),
        candidate_allowed(String.eq(old_environment, env), S.prefix(known, messages), key, List.length(&2, String, known), count)) :
        {H.longer(_, H.select(rest, env, messages, count)) ==
         S.select(Con{D.Receipt{key, old_environment, known}, rest}, env, messages, count) : D.Selection}
      %Equal.sym(D.Selection, H.select(rest, env, messages, count), S.select(rest, env, messages, count),
        HL.selection_refinement(rest, env, messages, count)) :
        {H.longer(S.allowed(String.eq(old_environment, env), S.prefix(known, messages), key, List.length(&2, String, known), count), _) ==
         S.select(Con{D.Receipt{key, old_environment, known}, rest}, env, messages, count) : D.Selection}
      longer_refinement(
        S.allowed(String.eq(old_environment, env), S.prefix(known, messages), key, List.length(&2, String, known), count),
        S.select(rest, env, messages, count))

def HL.wrong_environment_cannot_supply_an_offset(known, incoming): {==}

def HL.empty_prefix_cannot_select_a_page(key, length): {==}
