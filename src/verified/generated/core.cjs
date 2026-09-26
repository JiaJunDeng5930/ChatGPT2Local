// Generated from Bend; do not edit. Source/toolchain/glue SHA256: b9b26e3b39f414908c60c410a7b97348734eefa7d745219729da9180e300598d
"use strict";
function word_to_u32(w) {
  let x = 0;
  for (let i = 0; w.$ === "WCon"; i++) {
    x |= Number(w.head) << i;
    w = w.tail;
  }
  return x >>> 0;
}

function u32_to_word(x) {
  let w = {$: "WNil"};
  for (let i = 31; i >= 0; i--) {
    w = {$: "WCon", head: ((x >>> i) & 1) === 1, tail: w};
  }
  return w;
}

function cmp_new(a, b) {
  return {$: a < b ? "LT"
    : a === b ? "EQ" : "GT"};
}

function nat_divmod(a, b) {
  return b === 0n ? {$: "Tuple", fst: 0n, snd: a}
    : {$: "Tuple", fst: a / b, snd: a % b};
}

function nat_chk(n) {
  if (n > 281474976710655n) {
    throw "bend: a Nat past the largest immediate 2^48-1";
  }
  return n;
}

function f32_show(x) {
  if (x !== x) {
    return "nan";
  }
  if (!Number.isFinite(x) || Object.is(x, -0)) {
    return x < 0 ? "-inf"
      : x === 0 ? "-0" : "inf";
  }
  let s = "x";
  for (let p = 1; p <= 9 && Math.fround(Number(s)) !== x; p += 1) {
    s = String(Number(x.toExponential(p - 1)));
  }
  return s;
}

function f32_bits(x) {
  return new Uint32Array(new Float32Array([x]).buffer)[0];
}

function f32_from_bits(u) {
  return new Float32Array(new Uint32Array([u]).buffer)[0];
}

function f32_read(s) {
  const re = /^\s*[+-]?((\d+\.?\d*|\.\d+)(e[+-]?\d+)?|inf(inity)?|nan)$/i;
  const v = Number(s.replace(/inf\w*/i, "Infinity"));
  return re.test(s) ? {$: "Some", value: Math.fround(v)} : {$: "None"};
}

function char_new(code) {
  if (code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) {
    throw "bend: " + code + " is not a Unicode scalar value";
  }
  return String.fromCodePoint(code);
}

// Array
// =====

function array_new(d, v) {
  if (d > 31n) {
    throw "bend: an array past the deepest block class 31";
  }
  return Array(2 ** Number(d)).fill(v);
}

// An unbalanced tree fails, as in C.
function array_node(a, b) {
  if (a.length !== b.length) {
    throw "bend: runtime fail-stop";
  }
  return a.concat(b);
}

function array_rmw(a, i, f) {
  const at = i % a.length;
  const old = a[at];
  a[at] = f(old);
  return {$: "Tuple", fst: a, snd: old};
}

// Run
// ===

function run_jump(f, x) {
  return {$: "$JMP", f: f, x: x};
}

function run_tail(f, x) {
  return {$: "$JMP", f: f.j?.f === f ? f.j : f, x: [x]};
}

function run_clo(j) {
  const f = (x) => run_loop(j(x));
  f.j = j;
  j.f = f;
  return f;
}

function run_loop(r) {
  while (r !== null && typeof r === "object" && r.$ === "$JMP") {
    r = r.f(...r.x);
  }
  return r;
}

function run_lib(f, n) {
  return (...a) => a.length < n ? run_lib((...b) => f(...a, ...b), n - a.length)
    : run_loop(f(...a));
}
// Program
// =======

function $main$() {
  return {$: "Exports", ["turn"]: run_loop($turn_step$({$: "Prepared"}, {$: "Submit"})), ["prefix"]: run_loop($history_plan$("", "", {$: "Nil"}, {$: "Nil"})), ["history"]: run_loop($history_select$({$: "Nil"}, "", {$: "Nil"})), ["transcript"]: run_loop($transcript_item$("message", "assistant")), ["surface"]: run_loop($surface_resume$({$: "Evidence", ["present"]: false, ["untouched"]: false, ["idle"]: false, ["assistant_tail"]: false, ["recorded_key"]: "", ["key"]: "", ["recorded_operation"]: "", ["operation"]: "", ["recorded_answer"]: "", ["expected_answer"]: "", ["answer"]: ""})), ["lease"]: run_loop($lease_finish$({$: "Uncertain"}, false, false, false, false, false)), ["admission"]: run_loop($lease_attach$(false, false, false)), ["batch"]: run_loop($batch_plan$(run_loop($batch$domain$state$(run_loop($batch_claim$(run_loop($batch_initialize$()))))), {$: "Con", ["head"]: "prompt", ["tail"]: {$: "Nil"}})), ["restored"]: run_loop($batch_restore$({$: "PendingIntent"})), ["batch_decision"]: run_loop($batch_step$({$: "Batch", ["phase"]: {$: "Prepared"}, ["slot"]: 0n, ["current"]: "prompt", ["pending"]: {$: "Nil"}}, {$: "Submit"})), ["batch_acknowledgement"]: run_loop($batch_ack$({$: "Batch", ["phase"]: {$: "Attempted"}, ["slot"]: 0n, ["current"]: "prompt", ["pending"]: {$: "Nil"}}, 1n)), ["observation"]: run_loop($observation_step$(run_loop($observation_initialize$()), {$: "Uncertain"})), ["eligible_observation"]: run_loop($observation_eligible$({$: "Facts", ["present"]: true, ["running"]: false, ["has_text"]: true, ["completion_control"]: true, ["reply_error"]: false, ["stopped_badge"]: false, ["tools_in_flight"]: false})), ["broker"]: run_loop($broker_step$(run_loop($broker_initialize$("environment")), {$: "BeginFence"})), ["broker_trace"]: run_loop($broker_run$({$: "Con", ["head"]: {$: "BeginFence"}, ["tail"]: {$: "Nil"}}, run_loop($broker_initialize$("environment")))), ["progress"]: run_loop($progress_step$(run_loop($progress_initialize$({$: "Recorder"})), {$: "RecordBatch", ["count"]: 1n, ["now"]: 0n})), ["progress_trace"]: run_loop($progress_run$({$: "Con", ["head"]: {$: "Retire"}, ["tail"]: {$: "Nil"}}, run_loop($progress_initialize$({$: "Replica"})))), ["valid_progress"]: run_loop($progress_valid$({$: "Snapshot", ["revision"]: 0n, ["batch"]: 0n, ["active"]: 0n, ["time"]: {$: "None"}})), ["outbox"]: run_loop($outbox_step$(run_loop($outbox_initialize$()), {$: "Receipt", ["id"]: "example"})), ["contains"]: run_loop($outbox_contains$(run_loop($outbox_initialize$()), "example")), ["outbox_trace"]: run_loop($outbox_run$({$: "Con", ["head"]: {$: "Receipt", ["id"]: "example"}, ["tail"]: {$: "Nil"}}, run_loop($outbox_initialize$()))), ["replay"]: run_loop($replay_step$(run_loop($replay_initialize$()), {$: "Seal"})), ["closed_replay"]: run_loop($replay_closed$(run_loop($replay_initialize$()))), ["terminal_replay"]: run_loop($replay_terminal$(run_loop($replay_initialize$()))), ["replay_trace"]: run_loop($replay_run$({$: "Con", ["head"]: {$: "Seal"}, ["tail"]: {$: "Nil"}}, run_loop($replay_initialize$())))};
}

function $turn_step$(_s_0, _e_0) {
  return run_jump($kernel$step$, [_s_0, _e_0]);
}

function $history_plan$(_old_environment_0, _environment_0, _known_0, _incoming_0) {
  return run_jump($history$plan$, [_old_environment_0, _environment_0, _known_0, _incoming_0]);
}

function $history_select$(_receipts_0, _environment_0, _incoming_0) {
  return run_jump($history$select$, [_receipts_0, _environment_0, _incoming_0, run_loop($List$length$(_incoming_0))]);
}

function $transcript_item$(_kind_0, _role_0) {
  return run_jump($transcript$round_item$, [_kind_0, _role_0]);
}

function $surface_resume$(_evidence_0) {
  return run_jump($surface$resume$, [_evidence_0]);
}

function $lease_finish$(_report_0, _surface_error_0, _retain_0, _conversation_0, _connector_0, _bound_0) {
  return run_jump($lease$finish$, [_report_0, _surface_error_0, _retain_0, _conversation_0, _connector_0, _bound_0]);
}

function $lease_attach$(_unknown_0, _same_owner_0, _owner_alive_0) {
  return run_jump($lease$attach$, [_unknown_0, _same_owner_0, _owner_alive_0]);
}

function $batch_plan$(_state_0, _payloads_0) {
  return run_jump($batch$plan$, [_state_0, _payloads_0]);
}

function $batch$domain$state$(_d_0) {
  const _s_0 = _d_0["state"];
  const _e_0 = _d_0["effect"];
  return _s_0;
}

function $batch_claim$(_state_0) {
  return run_jump($batch$claim$, [_state_0]);
}

function $batch_initialize$() {
  return run_jump($batch$initialize$, []);
}

function $batch_restore$(_receipt_0) {
  return run_jump($batch$restore$, [_receipt_0]);
}

function $batch_step$(_state_0, _event_0) {
  return run_jump($batch$transition$, [_state_0, {$: "Control", ["event"]: _event_0}]);
}

function $batch_ack$(_state_0, _stage_0) {
  return run_jump($batch$transition$, [_state_0, {$: "StageAcknowledged", ["stage"]: _stage_0}]);
}

function $observation_step$(_state_0, _event_0) {
  return run_jump($observation$step$, [_state_0, _event_0]);
}

function $observation_initialize$() {
  return run_jump($observation$initialize$, []);
}

function $observation_eligible$(_facts_0) {
  return run_jump($observation$eligible$, [_facts_0]);
}

function $broker_step$(_state_0, _event_0) {
  return run_jump($broker$step$, [_state_0, _event_0]);
}

function $broker_initialize$(_environment_0) {
  return run_jump($broker$initialize$, [_environment_0]);
}

function $broker_run$(_events_0, _state_0) {
  return run_jump($broker$run$, [_events_0, _state_0]);
}

function $progress_step$(_state_0, _event_0) {
  return run_jump($progress$step$, [_state_0, _event_0]);
}

function $progress_initialize$(_role_0) {
  return run_jump($progress$initialize$, [_role_0]);
}

function $progress_run$(_events_0, _state_0) {
  return run_jump($progress$run$, [_events_0, _state_0]);
}

function $progress_valid$(_snapshot_0) {
  return run_jump($progress$valid$, [_snapshot_0]);
}

function $outbox_step$(_state_0, _event_0) {
  return run_jump($outbox$step$, [_state_0, _event_0]);
}

function $outbox_initialize$() {
  return run_jump($outbox$initialize$, []);
}

function $outbox_contains$(_state_0, _id_0) {
  return run_jump($outbox$domain$member$, [_id_0, run_loop($outbox$domain$names$(run_loop($outbox$domain$pending$(_state_0))))]);
}

function $outbox_run$(_events_0, _state_0) {
  return run_jump($outbox$run$, [_events_0, _state_0]);
}

function $replay_step$(_state_0, _event_0) {
  return run_jump($replay$step$, [_state_0, _event_0]);
}

function $replay_initialize$() {
  return run_jump($replay$initialize$, []);
}

function $replay_closed$(_state_0) {
  return run_jump($replay$domain$closed$, [run_loop($replay$domain$status$(_state_0))]);
}

function $replay_terminal$(_state_0) {
  return run_jump($replay$domain$has_terminal$, [run_loop($replay$domain$events$(_state_0))]);
}

function $replay_run$(_events_0, _state_0) {
  return run_jump($replay$run$, [_events_0, _state_0]);
}

function $kernel$step$(_s_0, _e_0) {
  if (_s_0.$ === "Fresh") {
    if (_e_0.$ === "Prepare") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "PrepareSurface"}};
    } else if (_e_0.$ === "Submit") {
      return {$: "Decision", ["phase"]: {$: "Fresh"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Accepted") {
      return {$: "Decision", ["phase"]: {$: "Fresh"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Finished") {
      return {$: "Decision", ["phase"]: {$: "Fresh"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Uncertain") {
      return {$: "Decision", ["phase"]: {$: "Fresh"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Attach") {
      return {$: "Decision", ["phase"]: {$: "Fresh"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Detach") {
      return {$: "Decision", ["phase"]: {$: "Fresh"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Recover") {
      return {$: "Decision", ["phase"]: {$: "Fresh"}, ["effect"]: {$: "NoEffect"}};
    } else {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    }
  } else if (_s_0.$ === "Prepared") {
    if (_e_0.$ === "Prepare") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Submit") {
      return {$: "Decision", ["phase"]: {$: "Attempted"}, ["effect"]: {$: "SendPrompt"}};
    } else if (_e_0.$ === "Accepted") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Finished") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Uncertain") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Attach") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Detach") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Recover") {
      return {$: "Decision", ["phase"]: {$: "Prepared"}, ["effect"]: {$: "NoEffect"}};
    } else {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    }
  } else if (_s_0.$ === "Attempted") {
    if (_e_0.$ === "Prepare") {
      return {$: "Decision", ["phase"]: {$: "Attempted"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Submit") {
      return {$: "Decision", ["phase"]: {$: "Attempted"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Accepted") {
      return {$: "Decision", ["phase"]: {$: "Running"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Finished") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "PublishFinal"}};
    } else if (_e_0.$ === "Uncertain") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Attach") {
      return {$: "Decision", ["phase"]: {$: "Attempted"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Detach") {
      return {$: "Decision", ["phase"]: {$: "Attempted"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Recover") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "ObserveOnly"}};
    } else {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "StopByUser"}};
    }
  } else if (_s_0.$ === "Running") {
    if (_e_0.$ === "Prepare") {
      return {$: "Decision", ["phase"]: {$: "Running"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Submit") {
      return {$: "Decision", ["phase"]: {$: "Running"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Accepted") {
      return {$: "Decision", ["phase"]: {$: "Running"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Finished") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "PublishFinal"}};
    } else if (_e_0.$ === "Uncertain") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Attach") {
      return {$: "Decision", ["phase"]: {$: "Running"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Detach") {
      return {$: "Decision", ["phase"]: {$: "Running"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Recover") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "ObserveOnly"}};
    } else {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "StopByUser"}};
    }
  } else if (_s_0.$ === "Unknown") {
    if (_e_0.$ === "Prepare") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Submit") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Accepted") {
      return {$: "Decision", ["phase"]: {$: "Running"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Finished") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "PublishFinal"}};
    } else if (_e_0.$ === "Uncertain") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Attach") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_e_0.$ === "Detach") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Recover") {
      return {$: "Decision", ["phase"]: {$: "Unknown"}, ["effect"]: {$: "ObserveOnly"}};
    } else {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "StopByUser"}};
    }
  } else if (_s_0.$ === "Completed") {
    if (_e_0.$ === "Prepare") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Submit") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Accepted") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Finished") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "ReplayFinal"}};
    } else if (_e_0.$ === "Uncertain") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Attach") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "ReplayFinal"}};
    } else if (_e_0.$ === "Detach") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Recover") {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "NoEffect"}};
    } else {
      return {$: "Decision", ["phase"]: {$: "Completed"}, ["effect"]: {$: "NoEffect"}};
    }
  } else {
    if (_e_0.$ === "Prepare") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Submit") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Accepted") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Finished") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Uncertain") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Attach") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "Reject"}};
    } else if (_e_0.$ === "Detach") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    } else if (_e_0.$ === "Recover") {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    } else {
      return {$: "Decision", ["phase"]: {$: "Cancelled"}, ["effect"]: {$: "NoEffect"}};
    }
  }
}

function $history$plan$(_known_environment_0, _environment_0, _known_0, _incoming_0) {
  return run_jump($history$with_envelope$, [run_loop($String$eq$(_known_environment_0, _environment_0)), run_loop($history$reconcile$(_known_0, _incoming_0))]);
}

function $history$select$(_receipts_0, _environment_0, _incoming_0, _length_0) {
  if (_receipts_0.$ === "Nil") {
    return {$: "NewConversation"};
  } else {
    const _t_0 = _receipts_0["head"];
    const _key_0 = _t_0["key"];
    const _old_environment_0 = _t_0["environment"];
    const _known_0 = _t_0["messages"];
    const _rest_0 = _receipts_0["tail"];
    return run_jump($history$longer$, [run_loop($history$candidate$(run_loop($history$plan$(_old_environment_0, _environment_0, _known_0, _incoming_0)), _key_0, _length_0)), run_loop($history$select$(_rest_0, _environment_0, _incoming_0, _length_0))]);
  }
}

function $List$length$(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return 0n;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return nat_chk(run_loop($List$length$(_t_0)) + 1n);
  }
}

function $transcript$round_item$(_kind_0, _role_0) {
  const _x_0 = run_loop($String$eq$(_kind_0, "custom_tool_call_output"));
  const _x_1 = run_loop($String$eq$(_kind_0, "tool_search_output"));
  const _x_2 = run_loop($String$eq$(_kind_0, "function_call_output"));
  const _x_3 = (_x_0 || _x_1);
  const _x_4 = run_loop($String$eq$(_kind_0, "tool_search_call"));
  const _x_5 = (_x_2 || _x_3);
  const _x_6 = run_loop($String$eq$(_kind_0, "custom_tool_call"));
  const _x_7 = (_x_4 || _x_5);
  const _x_8 = run_loop($String$eq$(_kind_0, "function_call"));
  const _x_9 = (_x_6 || _x_7);
  const _x_10 = run_loop($String$eq$(_kind_0, "reasoning"));
  const _x_11 = (_x_8 || _x_9);
  const _x_12 = run_loop($Bool$and$(run_loop($String$eq$(_kind_0, "message")), run_loop($String$eq$(_role_0, "assistant"))));
  const _x_13 = (_x_10 || _x_11);
  return (_x_12 || _x_13);
}

function $surface$resume$(_evidence_0) {
  const _present_0 = _evidence_0["present"];
  const _untouched_0 = _evidence_0["untouched"];
  const _idle_0 = _evidence_0["idle"];
  const _tail_0 = _evidence_0["assistant_tail"];
  const _old_key_0 = _evidence_0["recorded_key"];
  const _key_0 = _evidence_0["key"];
  const _old_operation_0 = _evidence_0["recorded_operation"];
  const _operation_0 = _evidence_0["operation"];
  const _old_answer_0 = _evidence_0["recorded_answer"];
  const _expected_0 = _evidence_0["expected_answer"];
  const _answer_0 = _evidence_0["answer"];
  return run_jump($surface$authorized$, [_present_0, _untouched_0, _idle_0, _tail_0, run_loop($String$eq$(_old_key_0, _key_0)), run_loop($String$eq$(_old_operation_0, _operation_0)), run_loop($String$eq$(_old_answer_0, _expected_0)), run_loop($String$eq$(_old_answer_0, _answer_0))]);
}

function $lease$finish$(_report_0, _surface_error_0, _retain_0, _conversation_0, _connector_0, _bound_0) {
  if (_report_0.$ === "UserCancelled") {
    return {$: "Decision", ["status"]: {$: "Cancelled"}, ["reusable"]: false, ["protect"]: false};
  } else if (_report_0.$ === "Uncertain") {
    return {$: "Decision", ["status"]: {$: "Unknown"}, ["reusable"]: false, ["protect"]: true};
  } else {
    if (_surface_error_0) {
      return {$: "Decision", ["status"]: {$: "Unknown"}, ["reusable"]: false, ["protect"]: true};
    } else {
      return run_jump($lease$completed$, [_retain_0, _conversation_0, _connector_0, _bound_0]);
    }
  }
}

function $lease$attach$(_unknown_0, _same_owner_0, _owner_alive_0) {
  if (_unknown_0) {
    return {$: "OwnerUnknown"};
  } else {
    if (_same_owner_0) {
      return {$: "Reattach"};
    } else {
      if (_owner_alive_0) {
        return {$: "OwnerBusy"};
      } else {
        return {$: "OwnerUnknown"};
      }
    }
  }
}

function $batch$plan$(_s_0, _payloads_0) {
  if (_s_0.$ === "Unclaimed") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "Reject"}};
  } else if (_s_0.$ === "Unplanned") {
    if (_payloads_0.$ === "Nil") {
      return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
    } else {
      const _current_0 = _payloads_0["head"];
      const _pending_0 = _payloads_0["tail"];
      return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: run_loop($domain$phase$(run_loop($kernel$step$({$: "Fresh"}, {$: "Prepare"})))), ["slot"]: 0n, ["current"]: _current_0, ["pending"]: _pending_0}, ["effect"]: {$: "PrepareSurface"}};
    }
  } else if (_s_0.$ === "Closed") {
    const _p_0 = _s_0["phase"];
    return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: _p_0}, ["effect"]: {$: "Reject"}};
  } else {
    const _p_1 = _s_0["phase"];
    const _s_1 = _s_0["slot"];
    const _c_0 = _s_0["current"];
    const _r_0 = _s_0["pending"];
    return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: _p_1, ["slot"]: _s_1, ["current"]: _c_0, ["pending"]: _r_0}, ["effect"]: {$: "Reject"}};
  }
}

function $batch$claim$(_s_0) {
  if (_s_0.$ === "Unclaimed") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "NoEffect"}};
  } else if (_s_0.$ === "Unplanned") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
  } else if (_s_0.$ === "Closed") {
    const _p_0 = _s_0["phase"];
    return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: _p_0}, ["effect"]: {$: "Reject"}};
  } else {
    const _p_1 = _s_0["phase"];
    const _n_0 = _s_0["slot"];
    const _c_0 = _s_0["current"];
    const _r_0 = _s_0["pending"];
    return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: _p_1, ["slot"]: _n_0, ["current"]: _c_0, ["pending"]: _r_0}, ["effect"]: {$: "Reject"}};
  }
}

function $batch$initialize$() {
  return {$: "Unclaimed"};
}

function $batch$restore$(_receipt_0) {
  if (_receipt_0.$ === "PendingIntent") {
    return {$: "Closed", ["phase"]: {$: "Unknown"}};
  } else if (_receipt_0.$ === "FinalReceipt") {
    return {$: "Closed", ["phase"]: {$: "Completed"}};
  } else {
    return {$: "Closed", ["phase"]: {$: "Cancelled"}};
  }
}

function $batch$transition$(_s_0, _input_0) {
  if (_input_0.$ === "Control") {
    const _e_0 = _input_0["event"];
    return run_jump($batch$step$, [_s_0, _e_0]);
  } else {
    const _n_0 = _input_0["stage"];
    return run_jump($batch$acknowledge$, [_s_0, _n_0]);
  }
}

function $observation$step$(_state_0, _event_0) {
  if (_state_0.$ === "Watching") {
    const _revision_0 = _state_0["revision"];
    const _baseline_0 = _state_0["baseline"];
    if (_event_0.$ === "Uncertain") {
      return {$: "Decision", ["state"]: {$: "Watching", ["revision"]: _revision_0, ["baseline"]: _baseline_0}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_event_0.$ === "CaptureBoundary") {
      const _next_0 = _event_0["revision"];
      const _text_0 = _event_0["text"];
      return run_jump($observation$capture$, [{$: "Watching", ["revision"]: _revision_0, ["baseline"]: _baseline_0}, _next_0, _text_0]);
    } else {
      const _facts_0 = _event_0["facts"];
      const _text_1 = _event_0["text"];
      const _signature_0 = _event_0["signature"];
      const _now_0 = _event_0["now"];
      const _stable_ms_0 = _event_0["stable_ms"];
      return run_jump($observation$sample_waiting$, [_revision_0, _baseline_0, _facts_0, _text_1, _signature_0, _now_0, _stable_ms_0]);
    }
  } else {
    const _revision_1 = _state_0["revision"];
    const _baseline_1 = _state_0["baseline"];
    const _previous_0 = _state_0["signature"];
    const _since_0 = _state_0["since"];
    if (_event_0.$ === "Uncertain") {
      return {$: "Decision", ["state"]: {$: "Watching", ["revision"]: _revision_1, ["baseline"]: _baseline_1}, ["effect"]: {$: "ObserveOnly"}};
    } else if (_event_0.$ === "CaptureBoundary") {
      const _next_1 = _event_0["revision"];
      const _text_2 = _event_0["text"];
      return run_jump($observation$capture$, [{$: "Candidate", ["revision"]: _revision_1, ["baseline"]: _baseline_1, ["signature"]: _previous_0, ["since"]: _since_0}, _next_1, _text_2]);
    } else {
      const _facts_1 = _event_0["facts"];
      const _text_3 = _event_0["text"];
      const _signature_1 = _event_0["signature"];
      const _now_1 = _event_0["now"];
      const _stable_ms_1 = _event_0["stable_ms"];
      return run_jump($observation$sample_candidate$, [_revision_1, _baseline_1, _previous_0, _since_0, _facts_1, _text_3, _signature_1, _now_1, _stable_ms_1]);
    }
  }
}

function $observation$initialize$() {
  return {$: "Watching", ["revision"]: 0n, ["baseline"]: {$: "None"}};
}

function $observation$eligible$(_facts_0) {
  const _t_0 = _facts_0["present"];
  if (_t_0) {
    const _t_1 = _facts_0["running"];
    if (!_t_1) {
      const _t_2 = _facts_0["has_text"];
      if (_t_2) {
        const _t_3 = _facts_0["completion_control"];
        if (_t_3) {
          const _t_4 = _facts_0["reply_error"];
          if (!_t_4) {
            const _t_5 = _facts_0["stopped_badge"];
            if (!_t_5) {
              const _t_6 = _facts_0["tools_in_flight"];
              if (!_t_6) {
                return true;
              } else {
                return false;
              }
            } else {
              const _10_0 = _facts_0["tools_in_flight"];
              return false;
            }
          } else {
            const _9_0 = _facts_0["stopped_badge"];
            const _10_1 = _facts_0["tools_in_flight"];
            return false;
          }
        } else {
          const _8_0 = _facts_0["reply_error"];
          const _9_1 = _facts_0["stopped_badge"];
          const _10_2 = _facts_0["tools_in_flight"];
          return false;
        }
      } else {
        const _7_0 = _facts_0["completion_control"];
        const _8_1 = _facts_0["reply_error"];
        const _9_2 = _facts_0["stopped_badge"];
        const _10_3 = _facts_0["tools_in_flight"];
        return false;
      }
    } else {
      const _6_0 = _facts_0["has_text"];
      const _7_1 = _facts_0["completion_control"];
      const _8_2 = _facts_0["reply_error"];
      const _9_3 = _facts_0["stopped_badge"];
      const _10_4 = _facts_0["tools_in_flight"];
      return false;
    }
  } else {
    const _5_0 = _facts_0["running"];
    const _6_1 = _facts_0["has_text"];
    const _7_2 = _facts_0["completion_control"];
    const _8_3 = _facts_0["reply_error"];
    const _9_4 = _facts_0["stopped_badge"];
    const _10_5 = _facts_0["tools_in_flight"];
    return false;
  }
}

function $broker$step$(_state_0, _event_0) {
  const _t_0 = _state_0["lifetime"];
  if (_t_0.$ === "Open") {
    const _env_0 = _state_0["environment"];
    const _revision_0 = _state_0["revision"];
    const _activities_0 = _state_0["activities"];
    const _invocations_0 = _state_0["invocations"];
    return run_jump($broker$open_step$, [_env_0, _revision_0, _activities_0, _invocations_0, _event_0]);
  } else if (_t_0.$ === "Sealed") {
    const _sealed_revision_0 = _t_0["revision"];
    const _env_1 = _state_0["environment"];
    const _revision_1 = _state_0["revision"];
    const _activities_1 = _state_0["activities"];
    const _invocations_1 = _state_0["invocations"];
    return run_jump($broker$sealed_step$, [_sealed_revision_0, _env_1, _revision_1, _activities_1, _invocations_1, _event_0]);
  } else {
    const _env_2 = _state_0["environment"];
    const _revision_2 = _state_0["revision"];
    const _activities_2 = _state_0["activities"];
    const _invocations_2 = _state_0["invocations"];
    return run_jump($broker$retired_step$, [{$: "Broker", ["lifetime"]: {$: "Retired"}, ["environment"]: _env_2, ["revision"]: _revision_2, ["activities"]: _activities_2, ["invocations"]: _invocations_2}, _event_0]);
  }
}

function $broker$initialize$(_environment_0) {
  return {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _environment_0, ["revision"]: 0n, ["activities"]: {$: "Nil"}, ["invocations"]: {$: "Nil"}};
}

function $broker$run$(_events_0, _state_0) {
  return run_jump($theory$transition$system$run$1$, [_events_0, _state_0]);
}

function $progress$step$(_state_0, _event_0) {
  const _role_0 = _state_0["role"];
  const _snapshot_0 = _state_0["snapshot"];
  const _observed_0 = _state_0["observed"];
  const _batches_0 = _state_0["batches"];
  const _t_0 = _state_0["retired"];
  if (!_t_0) {
    return run_jump($progress$open_step$, [_role_0, _snapshot_0, _observed_0, _batches_0, _event_0]);
  } else {
    return run_jump($progress$closed_step$, [{$: "Progress", ["role"]: _role_0, ["snapshot"]: _snapshot_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: true}, _event_0]);
  }
}

function $progress$initialize$(_role_0) {
  return {$: "Progress", ["role"]: _role_0, ["snapshot"]: {$: "Snapshot", ["revision"]: 0n, ["batch"]: 0n, ["active"]: 0n, ["time"]: {$: "None"}}, ["observed"]: 0n, ["batches"]: {$: "Nil"}, ["retired"]: false};
}

function $progress$run$(_events_0, _state_0) {
  return run_jump($theory$transition$system$run$2$, [_events_0, _state_0]);
}

function $progress$valid$(_snapshot_0) {
  const _revision_0 = _snapshot_0["revision"];
  const _batch_0 = _snapshot_0["batch"];
  const _active_0 = _snapshot_0["active"];
  const _time_0 = _snapshot_0["time"];
  const _x_0 = run_loop($Nat$is_eq$(_active_0, 0n));
  const _x_1 = run_loop($Nat$is_gt$(_batch_0, 0n));
  return run_jump($Bool$and$, [run_loop($Nat$is_le$(_batch_0, _revision_0)), run_loop($Bool$and$((_x_0 || _x_1), run_loop($progress$timestamp_valid$(_revision_0, _time_0))))]);
}

function $outbox$step$(_state_0, _event_0) {
  const _pending_0 = _state_0["pending"];
  const _spent_0 = _state_0["spent"];
  const _prelude_0 = _state_0["prelude"];
  if (_event_0.$ === "Offer") {
    const _calls_0 = _event_0["calls"];
    const _next_prelude_0 = _event_0["prelude"];
    return run_jump($outbox$offer$, [run_loop($outbox$domain$nonempty$(_pending_0)), run_loop($outbox$domain$nonempty$(_calls_0)), run_loop($outbox$domain$fresh$(_calls_0, _spent_0)), {$: "Outbox", ["pending"]: _pending_0, ["spent"]: _spent_0, ["prelude"]: _prelude_0}, _calls_0, _spent_0, _next_prelude_0]);
  } else {
    const _id_0 = _event_0["id"];
    return run_jump($outbox$receive$, [run_loop($outbox$domain$member$(_id_0, run_loop($outbox$domain$names$(_pending_0)))), {$: "Outbox", ["pending"]: _pending_0, ["spent"]: _spent_0, ["prelude"]: _prelude_0}, run_loop($outbox$domain$without$(_id_0, _pending_0)), _spent_0, _prelude_0]);
  }
}

function $outbox$initialize$() {
  return {$: "Outbox", ["pending"]: {$: "Nil"}, ["spent"]: {$: "Nil"}, ["prelude"]: ""};
}

function $outbox$domain$member$(_id_0, _ids_0) {
  if (_ids_0.$ === "Nil") {
    return false;
  } else {
    const _head_0 = _ids_0["head"];
    const _rest_0 = _ids_0["tail"];
    const _x_0 = run_loop($String$eq$(_id_0, _head_0));
    const _x_1 = run_loop($outbox$domain$member$(_id_0, _rest_0));
    return (_x_0 || _x_1);
  }
}

function $outbox$domain$names$(_calls_0) {
  if (_calls_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _calls_0["head"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _rest_0 = _calls_0["tail"];
    return {$: "Con", ["head"]: _id_0, ["tail"]: run_loop($outbox$domain$names$(_rest_0))};
  }
}

function $outbox$domain$pending$(_state_0) {
  const _pending_0 = _state_0["pending"];
  const _spent_0 = _state_0["spent"];
  const _prelude_0 = _state_0["prelude"];
  return _pending_0;
}

function $outbox$run$(_events_0, _state_0) {
  return run_jump($theory$transition$system$run$3$, [_events_0, _state_0]);
}

function $replay$step$(_state_0, _event_0) {
  const _status_0 = _state_0["status"];
  const _events_0 = _state_0["events"];
  const _reasoning_0 = _state_0["reasoning"];
  return run_jump($replay$closed_step$, [_status_0, _events_0, _reasoning_0, _event_0]);
}

function $replay$initialize$() {
  return {$: "Journal", ["status"]: {$: "Open"}, ["events"]: {$: "Nil"}, ["reasoning"]: {$: "Nil"}};
}

function $replay$domain$closed$(_status_0) {
  if (_status_0.$ === "Open") {
    return false;
  } else if (_status_0.$ === "Sealed") {
    return true;
  } else {
    const _reason_0 = _status_0["reason"];
    return true;
  }
}

function $replay$domain$status$(_state_0) {
  const _status_0 = _state_0["status"];
  const _events_0 = _state_0["events"];
  const _reasoning_0 = _state_0["reasoning"];
  return _status_0;
}

function $replay$domain$has_terminal$(_events_0) {
  if (_events_0.$ === "Nil") {
    return false;
  } else {
    const _t_0 = _events_0["head"];
    const _kind_0 = _t_0["kind"];
    const _payload_0 = _t_0["payload"];
    const _rest_0 = _events_0["tail"];
    const _x_0 = run_loop($replay$domain$terminal$(_kind_0));
    const _x_1 = run_loop($replay$domain$has_terminal$(_rest_0));
    return (_x_0 || _x_1);
  }
}

function $replay$domain$events$(_state_0) {
  const _status_0 = _state_0["status"];
  const _events_0 = _state_0["events"];
  const _reasoning_0 = _state_0["reasoning"];
  return _events_0;
}

function $replay$run$(_events_0, _state_0) {
  return run_jump($theory$transition$system$run$4$, [_events_0, _state_0]);
}

function $history$with_envelope$(_equal_0, _prefix_0) {
  if (_equal_0) {
    return _prefix_0;
  } else {
    return {$: "None"};
  }
}

function $String$eq$(_a_0, _b_0) {
  return run_jump($String$eq$fin$, [run_loop($String$cmp$(_a_0, _b_0))]);
}

function $history$reconcile$(_known_0, _incoming_0) {
  if (_known_0.$ === "Nil") {
    return {$: "Some", ["value"]: 0n};
  } else {
    const _h_0 = _known_0["head"];
    const _t_0 = _known_0["tail"];
    if (_incoming_0.$ === "Nil") {
      return {$: "None"};
    } else {
      const _a_0 = _incoming_0["head"];
      const _b_0 = _incoming_0["tail"];
      return run_jump($history$bump$, [run_loop($String$eq$(_h_0, _a_0)), run_loop($history$reconcile$(_t_0, _b_0))]);
    }
  }
}

function $history$longer$(_a_0, _b_0) {
  if (_a_0.$ === "NewConversation") {
    return _b_0;
  } else {
    const _k_0 = _a_0["key"];
    const _n_0 = _a_0["offset"];
    if (_b_0.$ === "NewConversation") {
      return {$: "ReuseConversation", ["key"]: _k_0, ["offset"]: _n_0};
    } else {
      const _kb_0 = _b_0["key"];
      const _nb_0 = _b_0["offset"];
      const _x_0 = run_loop($Nat$is_gt$(_n_0, _nb_0));
      const _x_1 = run_loop($Bool$and$(run_loop($Nat$is_eq$(_n_0, _nb_0)), run_loop($String$is_le$(_k_0, _kb_0))));
      return run_jump($history$prefer$, [(_x_0 || _x_1), {$: "ReuseConversation", ["key"]: _k_0, ["offset"]: _n_0}, {$: "ReuseConversation", ["key"]: _kb_0, ["offset"]: _nb_0}]);
    }
  }
}

function $history$candidate$(_offset_0, _key_0, _length_0) {
  if (_offset_0.$ === "None") {
    return {$: "NewConversation"};
  } else {
    const _n_0 = _offset_0["value"];
    return run_jump($history$eligible$, [run_loop($Bool$and$(run_loop($Nat$is_gt$(_n_0, 0n)), (_n_0 < _length_0))), _key_0, _n_0]);
  }
}

function $Bool$and$(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
  }
}

function $surface$authorized$(_present_0, _untouched_0, _idle_0, _tail_0, _key_matches_0, _operation_matches_0, _receipt_matches_0, _live_matches_0) {
  if (_present_0) {
    if (_untouched_0) {
      if (_idle_0) {
        if (_tail_0) {
          if (_key_matches_0) {
            if (_operation_matches_0) {
              if (_receipt_matches_0) {
                if (_live_matches_0) {
                  return true;
                } else {
                  return false;
                }
              } else {
                return false;
              }
            } else {
              return false;
            }
          } else {
            return false;
          }
        } else {
          return false;
        }
      } else {
        return false;
      }
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function $lease$completed$(_retain_0, _conversation_0, _connector_0, _bound_0) {
  if (_retain_0) {
    if (_conversation_0) {
      if (!_connector_0) {
        return {$: "Decision", ["status"]: {$: "Ready"}, ["reusable"]: true, ["protect"]: false};
      } else {
        if (_bound_0) {
          return {$: "Decision", ["status"]: {$: "Ready"}, ["reusable"]: true, ["protect"]: false};
        } else {
          return {$: "Decision", ["status"]: {$: "Ready"}, ["reusable"]: false, ["protect"]: false};
        }
      }
    } else {
      return {$: "Decision", ["status"]: {$: "Ready"}, ["reusable"]: false, ["protect"]: false};
    }
  } else {
    return {$: "Decision", ["status"]: {$: "Ready"}, ["reusable"]: false, ["protect"]: false};
  }
}

function $domain$phase$(_d_0) {
  const _s_0 = _d_0["phase"];
  const _e_0 = _d_0["effect"];
  return _s_0;
}

function $batch$step$(_s_0, _event_0) {
  if (_s_0.$ === "Unclaimed") {
    return run_jump($batch$unclaimed$, [_event_0]);
  } else if (_s_0.$ === "Unplanned") {
    return run_jump($batch$unplanned$, [_event_0]);
  } else if (_s_0.$ === "Closed") {
    const _phase_0 = _s_0["phase"];
    return run_jump($batch$closed$, [_phase_0, _event_0]);
  } else {
    const _phase_1 = _s_0["phase"];
    const _slot_0 = _s_0["slot"];
    const _current_0 = _s_0["current"];
    const _pending_0 = _s_0["pending"];
    return run_jump($batch$planned$, [_phase_1, _slot_0, _current_0, _pending_0, _event_0]);
  }
}

function $batch$acknowledge$(_s_0, _stage_0) {
  if (_s_0.$ === "Unclaimed") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "Reject"}};
  } else if (_s_0.$ === "Unplanned") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
  } else if (_s_0.$ === "Closed") {
    const _phase_0 = _s_0["phase"];
    return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: _phase_0}, ["effect"]: {$: "Reject"}};
  } else {
    const _phase_1 = _s_0["phase"];
    const _slot_0 = _s_0["slot"];
    const _current_0 = _s_0["current"];
    const _t_0 = _s_0["pending"];
    if (_t_0.$ === "Nil") {
      return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: _phase_1, ["slot"]: _slot_0, ["current"]: _current_0, ["pending"]: {$: "Nil"}}, ["effect"]: {$: "Reject"}};
    } else {
      const _next_0 = _t_0["head"];
      const _rest_0 = _t_0["tail"];
      return run_jump($batch$advance$, [run_loop($Bool$and$(run_loop($batch$active$(_phase_1)), run_loop($Nat$is_eq$(nat_chk(_slot_0 + 1n), _stage_0)))), _phase_1, _slot_0, _current_0, _next_0, _rest_0]);
    }
  }
}

function $observation$capture$(_state_0, _revision_0, _text_0) {
  const _x_0 = run_loop($observation$domain$revision$(_state_0));
  return run_jump($observation$captured$, [cmp_new(_x_0, _revision_0), _state_0, _revision_0, _text_0]);
}

function $observation$sample_waiting$(_revision_0, _baseline_0, _facts_0, _text_0, _signature_0, _now_0, _stable_ms_0) {
  return run_jump($observation$guarded$, [run_loop($observation$domain$has_tools$(_facts_0)), run_loop($observation$domain$baseline_matches$(_baseline_0, _text_0)), run_loop($observation$eligible$(_facts_0)), {$: "Watching", ["revision"]: _revision_0, ["baseline"]: _baseline_0}, _signature_0, _now_0, _stable_ms_0]);
}

function $observation$sample_candidate$(_revision_0, _baseline_0, _previous_0, _since_0, _facts_0, _text_0, _signature_0, _now_0, _stable_ms_0) {
  return run_jump($observation$guarded$, [run_loop($observation$domain$has_tools$(_facts_0)), run_loop($observation$domain$baseline_matches$(_baseline_0, _text_0)), run_loop($observation$eligible$(_facts_0)), {$: "Candidate", ["revision"]: _revision_0, ["baseline"]: _baseline_0, ["signature"]: _previous_0, ["since"]: _since_0}, _signature_0, _now_0, _stable_ms_0]);
}

function $broker$open_step$(_env_0, _revision_0, _activities_0, _invocations_0, _event_0) {
  if (_event_0.$ === "ClaimActivity") {
    const _id_0 = _event_0["id"];
    return run_jump($broker$claim$, [run_loop($broker$table$activity_get$(_id_0, _activities_0)), _id_0, _env_0, _revision_0, _activities_0, _invocations_0]);
  } else if (_event_0.$ === "CompleteActivity") {
    const _id_1 = _event_0["id"];
    return run_jump($broker$complete_activity$, [run_loop($broker$table$activity_get$(_id_1, _activities_0)), _id_1, _env_0, _revision_0, _activities_0, _invocations_0]);
  } else if (_event_0.$ === "Enqueue") {
    const _id_2 = _event_0["id"];
    const _payload_0 = _event_0["payload"];
    return run_jump($broker$enqueue$, [run_loop($broker$table$invocation_get$(_id_2, _invocations_0)), _id_2, _payload_0, _env_0, _revision_0, _activities_0, _invocations_0]);
  } else if (_event_0.$ === "Poll") {
    return run_jump($broker$poll$, [run_loop($broker$table$delivered$(_invocations_0)), run_loop($broker$table$queued$(_invocations_0)), _env_0, _revision_0, _activities_0, _invocations_0]);
  } else if (_event_0.$ === "CompleteCall") {
    const _id_3 = _event_0["id"];
    const _digest_0 = _event_0["digest"];
    return run_jump($broker$finish_found$, [run_loop($broker$table$invocation_get$(_id_3, _invocations_0)), _digest_0, _env_0, _revision_0, _activities_0, _invocations_0]);
  } else if (_event_0.$ === "BeginFence") {
    const _x_0 = run_loop($broker$table$has_activity$(_activities_0));
    const _x_1 = run_loop($broker$table$has_invocation$(_invocations_0));
    return run_jump($broker$offer$, [(_x_0 || _x_1), {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, _revision_0]);
  } else if (_event_0.$ === "CommitFence") {
    const _expected_0 = _event_0["revision"];
    const _x_2 = run_loop($broker$table$has_activity$(_activities_0));
    const _x_3 = run_loop($broker$table$has_invocation$(_invocations_0));
    return run_jump($broker$commit$, [run_loop($Bool$and$(run_loop($Nat$is_eq$(_revision_0, _expected_0)), run_loop($Bool$not$((_x_2 || _x_3))))), {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, _expected_0]);
  } else if (_event_0.$ === "CheckEnvironment") {
    const _expected_1 = _event_0["environment"];
    return run_jump($broker$environment$, [run_loop($String$eq$(_env_0, _expected_1)), {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}]);
  } else {
    return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Retired"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, ["effect"]: {$: "OwnerRetired"}};
  }
}

function $broker$sealed_step$(_sealed_revision_0, _env_0, _revision_0, _activities_0, _invocations_0, _event_0) {
  if (_event_0.$ === "ClaimActivity") {
    const _id_0 = _event_0["id"];
    return run_jump($broker$reject$, [{$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, {$: "OwnerClosed"}]);
  } else if (_event_0.$ === "Enqueue") {
    const _id_1 = _event_0["id"];
    const _payload_0 = _event_0["payload"];
    return run_jump($broker$reject$, [{$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, {$: "OwnerClosed"}]);
  } else if (_event_0.$ === "Poll") {
    return run_jump($broker$reject$, [{$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, {$: "OwnerClosed"}]);
  } else if (_event_0.$ === "CompleteActivity") {
    const _id_2 = _event_0["id"];
    return run_jump($broker$late_activity$, [run_loop($broker$table$activity_get$(_id_2, _activities_0)), {$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}]);
  } else if (_event_0.$ === "CompleteCall") {
    const _id_3 = _event_0["id"];
    const _digest_0 = _event_0["digest"];
    return run_jump($broker$sealed_result$, [run_loop($broker$table$invocation_get$(_id_3, _invocations_0)), _digest_0, {$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}]);
  } else if (_event_0.$ === "BeginFence") {
    const _x_0 = run_loop($broker$table$has_activity$(_activities_0));
    const _x_1 = run_loop($broker$table$has_invocation$(_invocations_0));
    return run_jump($broker$offer$, [(_x_0 || _x_1), {$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, _sealed_revision_0]);
  } else if (_event_0.$ === "CommitFence") {
    const _expected_0 = _event_0["revision"];
    const _x_2 = run_loop($broker$table$has_activity$(_activities_0));
    const _x_3 = run_loop($broker$table$has_invocation$(_invocations_0));
    return run_jump($broker$commit$, [run_loop($Bool$and$(run_loop($Nat$is_eq$(_sealed_revision_0, _expected_0)), run_loop($Bool$not$((_x_2 || _x_3))))), {$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, _expected_0]);
  } else if (_event_0.$ === "CheckEnvironment") {
    const _expected_1 = _event_0["environment"];
    return run_jump($broker$environment$, [run_loop($String$eq$(_env_0, _expected_1)), {$: "Broker", ["lifetime"]: {$: "Sealed", ["revision"]: _sealed_revision_0}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}]);
  } else {
    return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Retired"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, ["effect"]: {$: "OwnerRetired"}};
  }
}

function $broker$retired_step$(_state_0, _event_0) {
  if (_event_0.$ === "Retire") {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "RetirementReplayed"}};
  } else if (_event_0.$ === "CompleteActivity") {
    const _id_0 = _event_0["id"];
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "LateActivityReceipt"}};
  } else {
    return run_jump($broker$reject$, [_state_0, {$: "OwnerClosed"}]);
  }
}

function $theory$transition$system$run$1$(_events_0, _state_0) {
  if (_events_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _event_0 = _events_0["head"];
    const _rest_0 = _events_0["tail"];
    const _decision_0 = run_loop($broker$step$(_state_0, _event_0));
    return {$: "Con", ["head"]: _decision_0, ["tail"]: run_loop($theory$transition$system$run$1$(_rest_0, run_loop($broker$domain$state$(_decision_0))))};
  }
}

function $progress$open_step$(_role_0, _snapshot_0, _observed_0, _batches_0, _event_0) {
  if (_role_0.$ === "Recorder") {
    return run_jump($progress$recorder$, [_snapshot_0, _observed_0, _batches_0, _event_0]);
  } else {
    return run_jump($progress$replica$, [_snapshot_0, _observed_0, _batches_0, _event_0]);
  }
}

function $progress$closed_step$(_state_0, _event_0) {
  if (_event_0.$ === "Retire") {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "RetirementReplayed"}};
  } else {
    return run_jump($progress$reject$, [_state_0, {$: "OwnerRetired"}]);
  }
}

function $theory$transition$system$run$2$(_events_0, _state_0) {
  if (_events_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _event_0 = _events_0["head"];
    const _rest_0 = _events_0["tail"];
    const _decision_0 = run_loop($progress$step$(_state_0, _event_0));
    return {$: "Con", ["head"]: _decision_0, ["tail"]: run_loop($theory$transition$system$run$2$(_rest_0, run_loop($progress$domain$state$(_decision_0))))};
  }
}

function $Nat$is_le$(_a_0, _b_0) {
  return run_jump($Cmp$is_le$, [cmp_new(_a_0, _b_0)]);
}

function $Nat$is_eq$(_a_0, _b_0) {
  return run_jump($Cmp$is_eq$, [cmp_new(_a_0, _b_0)]);
}

function $Nat$is_gt$(_a_0, _b_0) {
  return run_jump($Cmp$is_gt$, [cmp_new(_a_0, _b_0)]);
}

function $progress$timestamp_valid$(_revision_0, _time_0) {
  if (_revision_0 === 0n) {
    if (_time_0.$ === "None") {
      return true;
    } else {
      return false;
    }
  } else {
    const _n_0 = (_revision_0 - 1n);
    if (_time_0.$ === "Some") {
      const _t_0 = _time_0["value"];
      return true;
    } else {
      return false;
    }
  }
}

function $outbox$offer$(_busy_0, _nonempty_0, _fresh_0, _old_0, _calls_0, _spent_0, _prelude_0) {
  if (_busy_0) {
    return {$: "Decision", ["state"]: _old_0, ["effect"]: {$: "Reject", ["reason"]: {$: "PendingBatch"}}};
  } else {
    if (!_nonempty_0) {
      return {$: "Decision", ["state"]: _old_0, ["effect"]: {$: "Reject", ["reason"]: {$: "EmptyBatch"}}};
    } else {
      if (!_fresh_0) {
        return {$: "Decision", ["state"]: _old_0, ["effect"]: {$: "Reject", ["reason"]: {$: "DuplicateCall"}}};
      } else {
        return {$: "Decision", ["state"]: {$: "Outbox", ["pending"]: _calls_0, ["spent"]: run_loop($List$append$(run_loop($outbox$domain$names$(_calls_0)), _spent_0)), ["prelude"]: _prelude_0}, ["effect"]: {$: "BatchPublished"}};
      }
    }
  }
}

function $outbox$domain$nonempty$(_calls_0) {
  if (_calls_0.$ === "Nil") {
    return false;
  } else {
    const _head_0 = _calls_0["head"];
    const _tail_0 = _calls_0["tail"];
    return true;
  }
}

function $outbox$domain$fresh$(_calls_0, _seen_0) {
  if (_calls_0.$ === "Nil") {
    return true;
  } else {
    const _t_0 = _calls_0["head"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _rest_0 = _calls_0["tail"];
    return run_jump($Bool$and$, [run_loop($Bool$not$(run_loop($outbox$domain$member$(_id_0, _seen_0)))), run_loop($outbox$domain$fresh$(_rest_0, {$: "Con", ["head"]: _id_0, ["tail"]: _seen_0}))]);
  }
}

function $outbox$receive$(_known_0, _old_0, _remaining_0, _spent_0, _prelude_0) {
  if (!_known_0) {
    return {$: "Decision", ["state"]: _old_0, ["effect"]: {$: "Reject", ["reason"]: {$: "UnknownCall"}}};
  } else {
    return {$: "Decision", ["state"]: {$: "Outbox", ["pending"]: _remaining_0, ["spent"]: _spent_0, ["prelude"]: run_loop($outbox$domain$prelude_for$(_remaining_0, _prelude_0))}, ["effect"]: {$: "ReceiptRecorded"}};
  }
}

function $outbox$domain$without$(_id_0, _calls_0) {
  if (_calls_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _calls_0["head"];
    const _key_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _rest_0 = _calls_0["tail"];
    return run_jump($outbox$domain$keep$, [run_loop($Bool$not$(run_loop($String$eq$(_id_0, _key_0)))), {$: "Call", ["id"]: _key_0, ["payload"]: _payload_0}, run_loop($outbox$domain$without$(_id_0, _rest_0))]);
  }
}

function $theory$transition$system$run$3$(_events_0, _state_0) {
  if (_events_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _event_0 = _events_0["head"];
    const _rest_0 = _events_0["tail"];
    const _decision_0 = run_loop($outbox$step$(_state_0, _event_0));
    return {$: "Con", ["head"]: _decision_0, ["tail"]: run_loop($theory$transition$system$run$3$(_rest_0, run_loop($outbox$domain$state$(_decision_0))))};
  }
}

function $replay$closed_step$(_status_0, _events_0, _reasoning_0, _event_0) {
  if (_status_0.$ === "Sealed") {
    if (_event_0.$ === "Seal") {
      return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Sealed"}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "CloseReplayed"}};
    } else {
      return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Sealed"}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "Reject", ["reason"]: {$: "JournalClosed"}}};
    }
  } else if (_status_0.$ === "Failed") {
    const _error_0 = _status_0["reason"];
    if (_event_0.$ === "Seal") {
      return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Failed", ["reason"]: _error_0}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "CloseReplayed"}};
    } else if (_event_0.$ === "Fail") {
      const _next_0 = _event_0["reason"];
      return run_jump($replay$failure$, [run_loop($String$eq$(_error_0, _next_0)), {$: "Journal", ["status"]: {$: "Failed", ["reason"]: _error_0}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}]);
    } else {
      return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Failed", ["reason"]: _error_0}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "Reject", ["reason"]: {$: "JournalClosed"}}};
    }
  } else {
    return run_jump($replay$open_step$, [_events_0, _reasoning_0, _event_0]);
  }
}

function $replay$domain$terminal$(_kind_0) {
  const _x_0 = run_loop($String$eq$(_kind_0, "error"));
  const _x_1 = run_loop($String$eq$(_kind_0, "incomplete"));
  const _x_2 = run_loop($String$eq$(_kind_0, "done"));
  const _x_3 = (_x_0 || _x_1);
  return (_x_2 || _x_3);
}

function $theory$transition$system$run$4$(_events_0, _state_0) {
  if (_events_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _event_0 = _events_0["head"];
    const _rest_0 = _events_0["tail"];
    const _decision_0 = run_loop($replay$step$(_state_0, _event_0));
    return {$: "Con", ["head"]: _decision_0, ["tail"]: run_loop($theory$transition$system$run$4$(_rest_0, run_loop($replay$domain$state$(_decision_0))))};
  }
}

function $String$eq$fin$(_r_0) {
  const _t_0 = _r_0["fst"];
  const _a2_0 = _t_0["fst"];
  const _b2_0 = _t_0["snd"];
  const _c_0 = _r_0["snd"];
  return run_jump($Cmp$is_eq$, [_c_0]);
}

function $String$cmp$(_a_0, _b_0) {
  if (_a_0 === "") {
    if (_b_0 === "") {
      return {$: "Tuple", ["fst"]: {$: "Tuple", ["fst"]: "", ["snd"]: ""}, ["snd"]: {$: "EQ"}};
    } else {
      const _h_0 = (_b_0.codePointAt(0) > 0xFFFF ? _b_0.slice(0, 2) : _b_0[0]);
      const _t_0 = (_b_0.codePointAt(0) > 0xFFFF ? _b_0.slice(2) : _b_0.slice(1));
      return {$: "Tuple", ["fst"]: {$: "Tuple", ["fst"]: "", ["snd"]: (_h_0 + _t_0)}, ["snd"]: {$: "LT"}};
    }
  } else {
    const _h_1 = (_a_0.codePointAt(0) > 0xFFFF ? _a_0.slice(0, 2) : _a_0[0]);
    const _t_1 = (_a_0.codePointAt(0) > 0xFFFF ? _a_0.slice(2) : _a_0.slice(1));
    if (_b_0 === "") {
      return {$: "Tuple", ["fst"]: {$: "Tuple", ["fst"]: (_h_1 + _t_1), ["snd"]: ""}, ["snd"]: {$: "GT"}};
    } else {
      const _h2_0 = (_b_0.codePointAt(0) > 0xFFFF ? _b_0.slice(0, 2) : _b_0[0]);
      const _t2_0 = (_b_0.codePointAt(0) > 0xFFFF ? _b_0.slice(2) : _b_0.slice(1));
      return run_jump($String$cmp$fin$, [_t_1, _t2_0, run_loop($Char$cmp$(_h_1, _h2_0))]);
    }
  }
}

function $history$bump$(_equal_0, _next_0) {
  if (!_equal_0) {
    return {$: "None"};
  } else {
    if (_next_0.$ === "None") {
      return {$: "None"};
    } else {
      const _n_0 = _next_0["value"];
      return {$: "Some", ["value"]: nat_chk(_n_0 + 1n)};
    }
  }
}

function $history$prefer$(_left_0, _a_0, _b_0) {
  if (_left_0) {
    return _a_0;
  } else {
    return _b_0;
  }
}

function $String$is_le$(_a_0, _b_0) {
  return run_jump($Cmp$is_le$, [run_loop($String$order$(_a_0, _b_0))]);
}

function $history$eligible$(_valid_0, _key_0, _offset_0) {
  if (!_valid_0) {
    return {$: "NewConversation"};
  } else {
    return {$: "ReuseConversation", ["key"]: _key_0, ["offset"]: _offset_0};
  }
}

function $batch$unclaimed$(_event_0) {
  if (_event_0.$ === "Prepare") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Submit") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Accepted") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Finished") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Uncertain") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "NoEffect"}};
  } else if (_event_0.$ === "Attach") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "NoEffect"}};
  } else if (_event_0.$ === "Detach") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "NoEffect"}};
  } else if (_event_0.$ === "Recover") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "NoEffect"}};
  } else {
    return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: {$: "Cancelled"}}, ["effect"]: {$: "NoEffect"}};
  }
}

function $batch$unplanned$(_event_0) {
  if (_event_0.$ === "Prepare") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Submit") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Accepted") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Finished") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Uncertain") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "NoEffect"}};
  } else if (_event_0.$ === "Attach") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "NoEffect"}};
  } else if (_event_0.$ === "Detach") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "NoEffect"}};
  } else if (_event_0.$ === "Recover") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "NoEffect"}};
  } else {
    return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: {$: "Cancelled"}}, ["effect"]: {$: "NoEffect"}};
  }
}

function $batch$closed$(_phase_0, _event_0) {
  if (_event_0.$ === "Prepare") {
    return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: _phase_0}, ["effect"]: {$: "Reject"}};
  } else if (_event_0.$ === "Submit") {
    return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: _phase_0}, ["effect"]: {$: "Reject"}};
  } else {
    return run_jump($batch$with_closed$, [run_loop($kernel$step$(_phase_0, _event_0))]);
  }
}

function $batch$planned$(_phase_0, _slot_0, _current_0, _pending_0, _event_0) {
  if (_event_0.$ === "Finished") {
    return run_jump($batch$finish$, [{$: "Batch", ["phase"]: _phase_0, ["slot"]: _slot_0, ["current"]: _current_0, ["pending"]: _pending_0}]);
  } else {
    return run_jump($batch$with_phase$, [run_loop($kernel$step$(_phase_0, _event_0)), _slot_0, _current_0, _pending_0]);
  }
}

function $batch$advance$(_ok_0, _phase_0, _slot_0, _current_0, _next_0, _rest_0) {
  if (!_ok_0) {
    return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: _phase_0, ["slot"]: _slot_0, ["current"]: _current_0, ["pending"]: {$: "Con", ["head"]: _next_0, ["tail"]: _rest_0}}, ["effect"]: {$: "Reject"}};
  } else {
    return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: {$: "Prepared"}, ["slot"]: nat_chk(_slot_0 + 1n), ["current"]: _next_0, ["pending"]: _rest_0}, ["effect"]: {$: "PrepareSurface"}};
  }
}

function $batch$active$(_phase_0) {
  if (_phase_0.$ === "Fresh") {
    return false;
  } else if (_phase_0.$ === "Prepared") {
    return false;
  } else if (_phase_0.$ === "Attempted") {
    return true;
  } else if (_phase_0.$ === "Running") {
    return true;
  } else if (_phase_0.$ === "Unknown") {
    return true;
  } else if (_phase_0.$ === "Completed") {
    return false;
  } else {
    return false;
  }
}

function $observation$captured$(_order_0, _state_0, _revision_0, _text_0) {
  if (_order_0.$ === "LT") {
    return {$: "Decision", ["state"]: {$: "Watching", ["revision"]: _revision_0, ["baseline"]: {$: "Some", ["value"]: _text_0}}, ["effect"]: {$: "BoundaryCaptured"}};
  } else if (_order_0.$ === "EQ") {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "DuplicateBoundary"}};
  } else {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "RejectBoundary"}};
  }
}

function $observation$domain$revision$(_s_0) {
  if (_s_0.$ === "Watching") {
    const _revision_0 = _s_0["revision"];
    const _baseline_0 = _s_0["baseline"];
    return _revision_0;
  } else {
    const _revision_1 = _s_0["revision"];
    const _baseline_1 = _s_0["baseline"];
    const _signature_0 = _s_0["signature"];
    const _since_0 = _s_0["since"];
    return _revision_1;
  }
}

function $observation$guarded$(_tools_0, _same_baseline_0, _clear_0, _state_0, _signature_0, _now_0, _stable_ms_0) {
  if (_tools_0) {
    return {$: "Decision", ["state"]: run_loop($observation$domain$waiting$(_state_0)), ["effect"]: {$: "WaitForTools"}};
  } else {
    if (_same_baseline_0) {
      return {$: "Decision", ["state"]: run_loop($observation$domain$waiting$(_state_0)), ["effect"]: {$: "WaitForPostToolAnswer"}};
    } else {
      if (!_clear_0) {
        return {$: "Decision", ["state"]: run_loop($observation$domain$waiting$(_state_0)), ["effect"]: {$: "ObserveOnly"}};
      } else {
        return run_jump($observation$candidate$, [_state_0, _signature_0, _now_0, _stable_ms_0]);
      }
    }
  }
}

function $observation$domain$has_tools$(_f_0) {
  const _present_0 = _f_0["present"];
  const _running_0 = _f_0["running"];
  const _text_0 = _f_0["has_text"];
  const _control_0 = _f_0["completion_control"];
  const _error_0 = _f_0["reply_error"];
  const _stopped_0 = _f_0["stopped_badge"];
  const _tools_0 = _f_0["tools_in_flight"];
  return _tools_0;
}

function $observation$domain$baseline_matches$(_baseline_0, _text_0) {
  if (_baseline_0.$ === "None") {
    return false;
  } else {
    const _previous_0 = _baseline_0["value"];
    return run_jump($String$eq$, [_previous_0, _text_0]);
  }
}

function $broker$claim$(_found_0, _id_0, _env_0, _revision_0, _activities_0, _invocations_0) {
  if (_found_0.$ === "None") {
    return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: nat_chk(_revision_0 + 1n), ["activities"]: run_loop($broker$table$activity_put$(_id_0, false, _activities_0)), ["invocations"]: _invocations_0}, ["effect"]: {$: "ActivityClaimed"}};
  } else {
    const _t_0 = _found_0["value"];
    if (!_t_0) {
      return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, ["effect"]: {$: "ActivityReplayed"}};
    } else {
      return run_jump($broker$reject$, [{$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, {$: "ActivityAlreadyCompleted"}]);
    }
  }
}

function $broker$table$activity_get$(_id_0, _entries_0) {
  if (_entries_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _t_0 = _entries_0["head"];
    const _key_0 = _t_0["id"];
    const _value_0 = _t_0["completed"];
    const _rest_0 = _entries_0["tail"];
    return run_jump($broker$table$activity_choice$, [run_loop($String$eq$(_id_0, _key_0)), _value_0, run_loop($broker$table$activity_get$(_id_0, _rest_0))]);
  }
}

function $broker$complete_activity$(_found_0, _id_0, _env_0, _revision_0, _activities_0, _invocations_0) {
  if (_found_0.$ === "None") {
    return run_jump($broker$close_activity$, [false, _id_0, _env_0, _revision_0, _activities_0, _invocations_0]);
  } else {
    const _t_0 = _found_0["value"];
    if (!_t_0) {
      return run_jump($broker$close_activity$, [true, _id_0, _env_0, _revision_0, _activities_0, _invocations_0]);
    } else {
      return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, ["effect"]: {$: "ActivityReceiptReplayed"}};
    }
  }
}

function $broker$enqueue$(_found_0, _id_0, _payload_0, _env_0, _revision_0, _activities_0, _invocations_0) {
  if (_found_0.$ === "None") {
    return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: nat_chk(_revision_0 + 1n), ["activities"]: _activities_0, ["invocations"]: run_loop($broker$table$invocation_put$({$: "Invocation", ["id"]: _id_0, ["payload"]: _payload_0, ["delivery"]: {$: "Queued"}}, _invocations_0))}, ["effect"]: {$: "InvocationQueued"}};
  } else {
    const _previous_0 = _found_0["value"];
    return run_jump($broker$reject$, [{$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, {$: "DuplicateInvocation"}]);
  }
}

function $broker$table$invocation_get$(_id_0, _entries_0) {
  if (_entries_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _t_0 = _entries_0["head"];
    const _key_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _delivery_0 = _t_0["delivery"];
    const _rest_0 = _entries_0["tail"];
    return run_jump($broker$table$invocation_choice$, [run_loop($String$eq$(_id_0, _key_0)), {$: "Invocation", ["id"]: _key_0, ["payload"]: _payload_0, ["delivery"]: _delivery_0}, run_loop($broker$table$invocation_get$(_id_0, _rest_0))]);
  }
}

function $broker$poll$(_delivered_0, _queued_0, _env_0, _revision_0, _activities_0, _invocations_0) {
  if (_delivered_0.$ === "Nil") {
    return run_jump($broker$deliver$, [_queued_0, _env_0, _revision_0, _activities_0, _invocations_0]);
  } else {
    const _h_0 = _delivered_0["head"];
    const _t_0 = _delivered_0["tail"];
    return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, ["effect"]: {$: "CallsReplayed", ["ids"]: {$: "Con", ["head"]: _h_0, ["tail"]: _t_0}}};
  }
}

function $broker$table$delivered$(_entries_0) {
  if (_entries_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _entries_0["head"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _delivery_0 = _t_0["delivery"];
    const _rest_0 = _entries_0["tail"];
    return run_jump($broker$table$select_delivered$, [_delivery_0, _id_0, run_loop($broker$table$delivered$(_rest_0))]);
  }
}

function $broker$table$queued$(_entries_0) {
  if (_entries_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _entries_0["head"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _delivery_0 = _t_0["delivery"];
    const _rest_0 = _entries_0["tail"];
    return run_jump($broker$table$select_queued$, [_delivery_0, _id_0, run_loop($broker$table$queued$(_rest_0))]);
  }
}

function $broker$finish_found$(_found_0, _digest_0, _env_0, _revision_0, _activities_0, _invocations_0) {
  if (_found_0.$ === "None") {
    return run_jump($broker$reject$, [{$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, {$: "CallNotPending"}]);
  } else {
    const _t_0 = _found_0["value"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _t_1 = _t_0["delivery"];
    if (_t_1.$ === "Queued") {
      return run_jump($broker$reject$, [{$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, {$: "CallNotDelivered"}]);
    } else if (_t_1.$ === "Delivered") {
      return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: nat_chk(_revision_0 + 1n), ["activities"]: _activities_0, ["invocations"]: run_loop($broker$table$invocation_put$({$: "Invocation", ["id"]: _id_0, ["payload"]: _payload_0, ["delivery"]: {$: "Result", ["digest"]: _digest_0}}, _invocations_0))}, ["effect"]: {$: "ResultAccepted"}};
    } else {
      const _previous_0 = _t_1["digest"];
      return run_jump($broker$replay_result$, [run_loop($String$eq$(_previous_0, _digest_0)), {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}]);
    }
  }
}

function $broker$offer$(_busy_0, _state_0, _revision_0) {
  if (_busy_0) {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "FenceUnavailable"}};
  } else {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "FenceOffered", ["revision"]: _revision_0}};
  }
}

function $broker$table$has_activity$(_entries_0) {
  if (_entries_0.$ === "Nil") {
    return false;
  } else {
    const _t_0 = _entries_0["head"];
    const _id_0 = _t_0["id"];
    const _completed_0 = _t_0["completed"];
    const _rest_0 = _entries_0["tail"];
    return run_jump($broker$table$active$, [_completed_0, run_loop($broker$table$has_activity$(_rest_0))]);
  }
}

function $broker$table$has_invocation$(_entries_0) {
  if (_entries_0.$ === "Nil") {
    return false;
  } else {
    const _t_0 = _entries_0["head"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _delivery_0 = _t_0["delivery"];
    const _rest_0 = _entries_0["tail"];
    const _x_0 = run_loop($broker$table$pending$(_delivery_0));
    const _x_1 = run_loop($broker$table$has_invocation$(_rest_0));
    return (_x_0 || _x_1);
  }
}

function $broker$commit$(_allowed_0, _state_0, _revision_0) {
  if (!_allowed_0) {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "FenceStale"}};
  } else {
    return {$: "Decision", ["state"]: run_loop($broker$domain$replace_lifetime$(_state_0, {$: "Sealed", ["revision"]: _revision_0})), ["effect"]: {$: "FenceCommitted"}};
  }
}

function $Bool$not$(_b_0) {
  if (!_b_0) {
    return true;
  } else {
    return false;
  }
}

function $broker$environment$(_matches_0, _state_0) {
  if (_matches_0) {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "EnvironmentAccepted"}};
  } else {
    return run_jump($broker$reject$, [_state_0, {$: "EnvironmentChanged"}]);
  }
}

function $broker$reject$(_state_0, _reason_0) {
  return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "Reject", ["reason"]: _reason_0}};
}

function $broker$late_activity$(_found_0, _state_0) {
  if (_found_0.$ === "Some") {
    const _t_0 = _found_0["value"];
    if (_t_0) {
      return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "ActivityReceiptReplayed"}};
    } else {
      return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "LateActivityReceipt"}};
    }
  } else {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "LateActivityReceipt"}};
  }
}

function $broker$sealed_result$(_found_0, _digest_0, _state_0) {
  if (_found_0.$ === "Some") {
    const _t_0 = _found_0["value"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _t_1 = _t_0["delivery"];
    if (_t_1.$ === "Result") {
      const _previous_0 = _t_1["digest"];
      return run_jump($broker$replay_result$, [run_loop($String$eq$(_previous_0, _digest_0)), _state_0]);
    } else {
      return run_jump($broker$reject$, [_state_0, {$: "OwnerClosed"}]);
    }
  } else {
    return run_jump($broker$reject$, [_state_0, {$: "OwnerClosed"}]);
  }
}

function $broker$domain$state$(_d_0) {
  const _s_0 = _d_0["state"];
  const _e_0 = _d_0["effect"];
  return _s_0;
}

function $progress$recorder$(_snapshot_0, _observed_0, _batches_0, _event_0) {
  const _revision_0 = _snapshot_0["revision"];
  const _previous_batch_0 = _snapshot_0["batch"];
  const _active_0 = _snapshot_0["active"];
  const _time_0 = _snapshot_0["time"];
  if (_event_0.$ === "RecordBatch") {
    const _count_0 = _event_0["count"];
    const _now_0 = _event_0["now"];
    return run_jump($progress$batch$, [_count_0, _revision_0, _previous_batch_0, _active_0, _time_0, _observed_0, _batches_0, _now_0]);
  } else if (_event_0.$ === "RecordResult") {
    const _now_1 = _event_0["now"];
    return run_jump($progress$result$, [_active_0, _revision_0, _previous_batch_0, _time_0, _observed_0, _batches_0, _now_1]);
  } else if (_event_0.$ === "CheckBatch") {
    const _r_0 = _event_0["revision"];
    return run_jump($progress$check$, [run_loop($Bool$and$(run_loop($Nat$is_gt$(_r_0, 0n)), run_loop($progress$domain$member$(_r_0, _batches_0)))), run_loop($Nat$is_le$(_r_0, _observed_0)), {$: "Progress", ["role"]: {$: "Recorder"}, ["snapshot"]: {$: "Snapshot", ["revision"]: _revision_0, ["batch"]: _previous_batch_0, ["active"]: _active_0, ["time"]: _time_0}, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}]);
  } else if (_event_0.$ === "Acknowledge") {
    const _r_1 = _event_0["revision"];
    return run_jump($progress$acknowledge$, [run_loop($Bool$and$(run_loop($Nat$is_gt$(_r_1, 0n)), run_loop($progress$domain$member$(_r_1, _batches_0)))), run_loop($Nat$is_gt$(_r_1, _observed_0)), {$: "Recorder"}, {$: "Snapshot", ["revision"]: _revision_0, ["batch"]: _previous_batch_0, ["active"]: _active_0, ["time"]: _time_0}, _observed_0, _batches_0, _r_1]);
  } else if (_event_0.$ === "Import") {
    const _next_0 = _event_0["snapshot"];
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: {$: "Recorder"}, ["snapshot"]: {$: "Snapshot", ["revision"]: _revision_0, ["batch"]: _previous_batch_0, ["active"]: _active_0, ["time"]: _time_0}, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "WrongRole"}]);
  } else {
    return run_jump($progress$retire$, [{$: "Recorder"}, _revision_0, _previous_batch_0, _active_0, _time_0, _observed_0, _batches_0]);
  }
}

function $progress$replica$(_snapshot_0, _observed_0, _batches_0, _event_0) {
  if (_event_0.$ === "RecordBatch") {
    const _count_0 = _event_0["count"];
    const _now_0 = _event_0["now"];
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: _snapshot_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "WrongRole"}]);
  } else if (_event_0.$ === "RecordResult") {
    const _now_1 = _event_0["now"];
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: _snapshot_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "WrongRole"}]);
  } else if (_event_0.$ === "CheckBatch") {
    const _r_0 = _event_0["revision"];
    return run_jump($progress$check$, [run_loop($Bool$and$(run_loop($Nat$is_gt$(_r_0, 0n)), run_loop($progress$domain$member$(_r_0, _batches_0)))), run_loop($Nat$is_le$(_r_0, _observed_0)), {$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: _snapshot_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}]);
  } else if (_event_0.$ === "Acknowledge") {
    const _r_1 = _event_0["revision"];
    return run_jump($progress$acknowledge$, [run_loop($Bool$and$(run_loop($Nat$is_gt$(_r_1, 0n)), run_loop($progress$domain$member$(_r_1, _batches_0)))), run_loop($Nat$is_gt$(_r_1, _observed_0)), {$: "Replica"}, _snapshot_0, _observed_0, _batches_0, _r_1]);
  } else if (_event_0.$ === "Import") {
    const _next_0 = _event_0["snapshot"];
    return run_jump($progress$import_valid$, [run_loop($progress$valid$(_next_0)), _snapshot_0, _next_0, _observed_0, _batches_0]);
  } else {
    return run_jump($progress$retire_snapshot$, [_snapshot_0, _observed_0, _batches_0]);
  }
}

function $progress$reject$(_state_0, _reason_0) {
  return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "Reject", ["reason"]: _reason_0}};
}

function $progress$domain$state$(_decision_0) {
  const _state_0 = _decision_0["state"];
  const _effect_0 = _decision_0["effect"];
  return _state_0;
}

function $Cmp$is_le$(_c_0) {
  if (_c_0.$ === "LT") {
    return true;
  } else if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

function $Cmp$is_eq$(_c_0) {
  if (_c_0.$ === "LT") {
    return false;
  } else if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

function $Cmp$is_gt$(_c_0) {
  if (_c_0.$ === "LT") {
    return false;
  } else if (_c_0.$ === "EQ") {
    return false;
  } else {
    return true;
  }
}

function $List$append$(_xs_0, _ys_0) {
  if (_xs_0.$ === "Nil") {
    return _ys_0;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return {$: "Con", ["head"]: _h_0, ["tail"]: run_loop($List$append$(_t_0, _ys_0))};
  }
}

function $outbox$domain$prelude_for$(_pending_0, _prelude_0) {
  if (_pending_0.$ === "Nil") {
    return "";
  } else {
    const _head_0 = _pending_0["head"];
    const _tail_0 = _pending_0["tail"];
    return _prelude_0;
  }
}

function $outbox$domain$keep$(_different_0, _call_0, _rest_0) {
  if (_different_0) {
    return {$: "Con", ["head"]: _call_0, ["tail"]: _rest_0};
  } else {
    return _rest_0;
  }
}

function $outbox$domain$state$(_decision_0) {
  const _state_0 = _decision_0["state"];
  const _effect_0 = _decision_0["effect"];
  return _state_0;
}

function $replay$failure$(_equal_0, _state_0) {
  if (_equal_0) {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "FailureReplayed"}};
  } else {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "Reject", ["reason"]: {$: "ConflictingFailure"}}};
  }
}

function $replay$open_step$(_events_0, _reasoning_0, _event_0) {
  if (_event_0.$ === "Append") {
    const _next_0 = _event_0["events"];
    return run_jump($replay$append$, [run_loop($replay$domain$has_terminal$(_events_0)), run_loop($replay$domain$well_formed$(_next_0)), _events_0, _reasoning_0, _next_0]);
  } else if (_event_0.$ === "Reason") {
    const _parts_0 = _event_0["parts"];
    return run_jump($replay$reason$, [run_loop($replay$domain$has_terminal$(_events_0)), _events_0, _reasoning_0, _parts_0]);
  } else if (_event_0.$ === "Seal") {
    return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Sealed"}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "Closed"}};
  } else {
    const _error_0 = _event_0["reason"];
    return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Failed", ["reason"]: _error_0}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "FailureRecorded"}};
  }
}

function $replay$domain$state$(_decision_0) {
  const _state_0 = _decision_0["state"];
  const _effect_0 = _decision_0["effect"];
  return _state_0;
}

function $String$cmp$fin$(_t1_0, _t2_0, _hc_0) {
  const _t_0 = _hc_0["fst"];
  const _h1b_0 = _t_0["fst"];
  const _h2b_0 = _t_0["snd"];
  const _t_1 = _hc_0["snd"];
  if (_t_1.$ === "LT") {
    return {$: "Tuple", ["fst"]: {$: "Tuple", ["fst"]: (_h1b_0 + _t1_0), ["snd"]: (_h2b_0 + _t2_0)}, ["snd"]: {$: "LT"}};
  } else if (_t_1.$ === "EQ") {
    return run_jump($String$cmp$rec$, [_h1b_0, _h2b_0, run_loop($String$cmp$(_t1_0, _t2_0))]);
  } else {
    return {$: "Tuple", ["fst"]: {$: "Tuple", ["fst"]: (_h1b_0 + _t1_0), ["snd"]: (_h2b_0 + _t2_0)}, ["snd"]: {$: "GT"}};
  }
}

function $Char$cmp$(_a_0, _b_0) {
  const _x_0 = _a_0.codePointAt(0);
  const _y_0 = _b_0.codePointAt(0);
  return {$: "Tuple", ["fst"]: {$: "Tuple", ["fst"]: char_new(_x_0), ["snd"]: char_new(_y_0)}, ["snd"]: cmp_new(_x_0, _y_0)};
}

function $String$order$(_a_0, _b_0) {
  return run_jump($String$order$fin$, [run_loop($String$cmp$(_a_0, _b_0))]);
}

function $batch$with_closed$(_decision_0) {
  const _phase_0 = _decision_0["phase"];
  const _effect_0 = _decision_0["effect"];
  return {$: "BatchDecision", ["state"]: {$: "Closed", ["phase"]: _phase_0}, ["effect"]: _effect_0};
}

function $batch$finish$(_s_0) {
  if (_s_0.$ === "Unclaimed") {
    return {$: "BatchDecision", ["state"]: {$: "Unclaimed"}, ["effect"]: {$: "Reject"}};
  } else if (_s_0.$ === "Unplanned") {
    return {$: "BatchDecision", ["state"]: {$: "Unplanned"}, ["effect"]: {$: "Reject"}};
  } else if (_s_0.$ === "Closed") {
    const _phase_0 = _s_0["phase"];
    return run_jump($batch$with_closed$, [run_loop($kernel$step$(_phase_0, {$: "Finished"}))]);
  } else {
    const _phase_1 = _s_0["phase"];
    const _slot_0 = _s_0["slot"];
    const _current_0 = _s_0["current"];
    const _t_0 = _s_0["pending"];
    if (_t_0.$ === "Nil") {
      return run_jump($batch$with_phase$, [run_loop($kernel$step$(_phase_1, {$: "Finished"})), _slot_0, _current_0, {$: "Nil"}]);
    } else {
      const _h_0 = _t_0["head"];
      const _t_1 = _t_0["tail"];
      return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: _phase_1, ["slot"]: _slot_0, ["current"]: _current_0, ["pending"]: {$: "Con", ["head"]: _h_0, ["tail"]: _t_1}}, ["effect"]: {$: "Reject"}};
    }
  }
}

function $batch$with_phase$(_d_0, _slot_0, _current_0, _pending_0) {
  const _phase_0 = _d_0["phase"];
  const _effect_0 = _d_0["effect"];
  return {$: "BatchDecision", ["state"]: {$: "Batch", ["phase"]: _phase_0, ["slot"]: _slot_0, ["current"]: _current_0, ["pending"]: _pending_0}, ["effect"]: _effect_0};
}

function $observation$domain$waiting$(_s_0) {
  if (_s_0.$ === "Watching") {
    const _revision_0 = _s_0["revision"];
    const _baseline_0 = _s_0["baseline"];
    return {$: "Watching", ["revision"]: _revision_0, ["baseline"]: _baseline_0};
  } else {
    const _revision_1 = _s_0["revision"];
    const _baseline_1 = _s_0["baseline"];
    const _signature_0 = _s_0["signature"];
    const _since_0 = _s_0["since"];
    return {$: "Watching", ["revision"]: _revision_1, ["baseline"]: _baseline_1};
  }
}

function $observation$candidate$(_s_0, _signature_0, _now_0, _stable_ms_0) {
  if (_s_0.$ === "Watching") {
    const _revision_0 = _s_0["revision"];
    const _baseline_0 = _s_0["baseline"];
    return {$: "Decision", ["state"]: {$: "Candidate", ["revision"]: _revision_0, ["baseline"]: _baseline_0, ["signature"]: _signature_0, ["since"]: _now_0}, ["effect"]: {$: "ObserveOnly"}};
  } else {
    const _revision_1 = _s_0["revision"];
    const _baseline_1 = _s_0["baseline"];
    const _previous_0 = _s_0["signature"];
    const _since_0 = _s_0["since"];
    return run_jump($observation$stable$, [run_loop($String$eq$(_previous_0, _signature_0)), run_loop($Nat$is_le$(_since_0, _now_0)), run_loop($Nat$is_ge$((_now_0 < _since_0 ? 0n : _now_0 - _since_0), _stable_ms_0)), _revision_1, _baseline_1, _signature_0, _since_0, _now_0]);
  }
}

function $broker$table$activity_put$(_id_0, _completed_0, _entries_0) {
  if (_entries_0.$ === "Nil") {
    return {$: "Con", ["head"]: {$: "Activity", ["id"]: _id_0, ["completed"]: _completed_0}, ["tail"]: {$: "Nil"}};
  } else {
    const _t_0 = _entries_0["head"];
    const _key_0 = _t_0["id"];
    const _previous_0 = _t_0["completed"];
    const _rest_0 = _entries_0["tail"];
    return run_jump($broker$table$activity_cons$, [run_loop($String$eq$(_id_0, _key_0)), {$: "Activity", ["id"]: _id_0, ["completed"]: _completed_0}, {$: "Activity", ["id"]: _key_0, ["completed"]: _previous_0}, _rest_0, run_loop($broker$table$activity_put$(_id_0, _completed_0, _rest_0))]);
  }
}

function $broker$table$activity_choice$(_matches_0, _value_0, _rest_0) {
  if (_matches_0) {
    return {$: "Some", ["value"]: _value_0};
  } else {
    return _rest_0;
  }
}

function $broker$close_activity$(_was_active_0, _id_0, _env_0, _revision_0, _activities_0, _invocations_0) {
  return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: nat_chk(_revision_0 + 1n), ["activities"]: run_loop($broker$table$activity_put$(_id_0, true, _activities_0)), ["invocations"]: _invocations_0}, ["effect"]: {$: "ActivityClosed", ["was_active"]: _was_active_0}};
}

function $broker$table$invocation_put$(_entry_0, _entries_0) {
  if (_entries_0.$ === "Nil") {
    return {$: "Con", ["head"]: _entry_0, ["tail"]: {$: "Nil"}};
  } else {
    const _previous_0 = _entries_0["head"];
    const _rest_0 = _entries_0["tail"];
    return run_jump($broker$table$invocation_cons$, [run_loop($String$eq$(run_loop($broker$domain$invocation_id$(_entry_0)), run_loop($broker$domain$invocation_id$(_previous_0)))), _entry_0, _previous_0, _rest_0, run_loop($broker$table$invocation_put$(_entry_0, _rest_0))]);
  }
}

function $broker$table$invocation_choice$(_matches_0, _value_0, _rest_0) {
  if (_matches_0) {
    return {$: "Some", ["value"]: _value_0};
  } else {
    return _rest_0;
  }
}

function $broker$deliver$(_queued_0, _env_0, _revision_0, _activities_0, _invocations_0) {
  if (_queued_0.$ === "Nil") {
    return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0}, ["effect"]: {$: "WaitForCalls"}};
  } else {
    const _h_0 = _queued_0["head"];
    const _t_0 = _queued_0["tail"];
    return {$: "Decision", ["state"]: {$: "Broker", ["lifetime"]: {$: "Open"}, ["environment"]: _env_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: run_loop($broker$table$deliver_all$(_invocations_0))}, ["effect"]: {$: "CallsDelivered", ["ids"]: {$: "Con", ["head"]: _h_0, ["tail"]: _t_0}}};
  }
}

function $broker$table$select_delivered$(_delivery_0, _id_0, _rest_0) {
  if (_delivery_0.$ === "Queued") {
    return _rest_0;
  } else if (_delivery_0.$ === "Delivered") {
    return {$: "Con", ["head"]: _id_0, ["tail"]: _rest_0};
  } else {
    const _digest_0 = _delivery_0["digest"];
    return _rest_0;
  }
}

function $broker$table$select_queued$(_delivery_0, _id_0, _rest_0) {
  if (_delivery_0.$ === "Queued") {
    return {$: "Con", ["head"]: _id_0, ["tail"]: _rest_0};
  } else if (_delivery_0.$ === "Delivered") {
    return _rest_0;
  } else {
    const _digest_0 = _delivery_0["digest"];
    return _rest_0;
  }
}

function $broker$replay_result$(_matches_0, _state_0) {
  if (_matches_0) {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "ResultReplayed"}};
  } else {
    return run_jump($broker$reject$, [_state_0, {$: "ConflictingResult"}]);
  }
}

function $broker$table$active$(_completed_0, _rest_0) {
  if (!_completed_0) {
    return true;
  } else {
    return _rest_0;
  }
}

function $broker$table$pending$(_delivery_0) {
  if (_delivery_0.$ === "Queued") {
    return true;
  } else if (_delivery_0.$ === "Delivered") {
    return true;
  } else {
    const _digest_0 = _delivery_0["digest"];
    return false;
  }
}

function $broker$domain$replace_lifetime$(_s_0, _lifetime_0) {
  const _old_0 = _s_0["lifetime"];
  const _environment_0 = _s_0["environment"];
  const _revision_0 = _s_0["revision"];
  const _activities_0 = _s_0["activities"];
  const _invocations_0 = _s_0["invocations"];
  return {$: "Broker", ["lifetime"]: _lifetime_0, ["environment"]: _environment_0, ["revision"]: _revision_0, ["activities"]: _activities_0, ["invocations"]: _invocations_0};
}

function $progress$batch$(_count_0, _revision_0, _previous_batch_0, _active_0, _time_0, _observed_0, _batches_0, _now_0) {
  if (_count_0 === 0n) {
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: {$: "Recorder"}, ["snapshot"]: {$: "Snapshot", ["revision"]: _revision_0, ["batch"]: _previous_batch_0, ["active"]: _active_0, ["time"]: _time_0}, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "EmptyBatch"}]);
  } else {
    const _n_0 = (_count_0 - 1n);
    const _x_0 = nat_chk(_n_0 + 1n);
    return {$: "Decision", ["state"]: {$: "Progress", ["role"]: {$: "Recorder"}, ["snapshot"]: {$: "Snapshot", ["revision"]: nat_chk(_revision_0 + 1n), ["batch"]: nat_chk(_revision_0 + 1n), ["active"]: nat_chk(_active_0 + _x_0), ["time"]: run_loop($progress$touch$(_time_0, _now_0))}, ["observed"]: _observed_0, ["batches"]: {$: "Con", ["head"]: nat_chk(_revision_0 + 1n), ["tail"]: _batches_0}, ["retired"]: false}, ["effect"]: {$: "ProgressChanged"}};
  }
}

function $progress$result$(_active_0, _revision_0, _previous_batch_0, _time_0, _observed_0, _batches_0, _now_0) {
  if (_active_0 === 0n) {
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: {$: "Recorder"}, ["snapshot"]: {$: "Snapshot", ["revision"]: _revision_0, ["batch"]: _previous_batch_0, ["active"]: 0n, ["time"]: _time_0}, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "NoPendingCall"}]);
  } else {
    const _n_0 = (_active_0 - 1n);
    return {$: "Decision", ["state"]: {$: "Progress", ["role"]: {$: "Recorder"}, ["snapshot"]: {$: "Snapshot", ["revision"]: nat_chk(_revision_0 + 1n), ["batch"]: _previous_batch_0, ["active"]: _n_0, ["time"]: run_loop($progress$touch$(_time_0, _now_0))}, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, ["effect"]: {$: "ProgressChanged"}};
  }
}

function $progress$check$(_known_0, _observed_0, _state_0) {
  if (!_known_0) {
    return run_jump($progress$reject$, [_state_0, {$: "InvalidBatch"}]);
  } else {
    if (!_observed_0) {
      return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "ObservationNeeded"}};
    } else {
      return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "ObservationKnown"}};
    }
  }
}

function $progress$domain$member$(_revision_0, _batches_0) {
  if (_batches_0.$ === "Nil") {
    return false;
  } else {
    const _head_0 = _batches_0["head"];
    const _rest_0 = _batches_0["tail"];
    const _x_0 = run_loop($Nat$is_eq$(_revision_0, _head_0));
    const _x_1 = run_loop($progress$domain$member$(_revision_0, _rest_0));
    return (_x_0 || _x_1);
  }
}

function $progress$acknowledge$(_known_0, _newer_0, _role_0, _snapshot_0, _observed_0, _batches_0, _revision_0) {
  if (!_known_0) {
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: _role_0, ["snapshot"]: _snapshot_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "InvalidBatch"}]);
  } else {
    if (!_newer_0) {
      return {$: "Decision", ["state"]: {$: "Progress", ["role"]: _role_0, ["snapshot"]: _snapshot_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, ["effect"]: {$: "ObservationReplayed"}};
    } else {
      return {$: "Decision", ["state"]: {$: "Progress", ["role"]: _role_0, ["snapshot"]: _snapshot_0, ["observed"]: _revision_0, ["batches"]: _batches_0, ["retired"]: false}, ["effect"]: {$: "ObservationCommitted"}};
    }
  }
}

function $progress$retire$(_role_0, _revision_0, _batch_0, _active_0, _time_0, _observed_0, _batches_0) {
  if (_active_0 === 0n) {
    return {$: "Decision", ["state"]: {$: "Progress", ["role"]: _role_0, ["snapshot"]: {$: "Snapshot", ["revision"]: _revision_0, ["batch"]: _batch_0, ["active"]: 0n, ["time"]: _time_0}, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: true}, ["effect"]: {$: "OwnerClosed"}};
  } else {
    const _n_0 = (_active_0 - 1n);
    return {$: "Decision", ["state"]: {$: "Progress", ["role"]: _role_0, ["snapshot"]: {$: "Snapshot", ["revision"]: nat_chk(_revision_0 + 1n), ["batch"]: _batch_0, ["active"]: 0n, ["time"]: _time_0}, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: true}, ["effect"]: {$: "OwnerClosed"}};
  }
}

function $progress$import_valid$(_valid_0, _old_0, _next_0, _observed_0, _batches_0) {
  if (!_valid_0) {
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: _old_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "InvalidSnapshot"}]);
  } else {
    const _x_0 = run_loop($progress$domain$revision$(_next_0));
    const _x_1 = run_loop($progress$domain$revision$(_old_0));
    return run_jump($progress$import_order$, [cmp_new(_x_0, _x_1), _old_0, _next_0, _observed_0, _batches_0]);
  }
}

function $progress$retire_snapshot$(_snapshot_0, _observed_0, _batches_0) {
  const _revision_0 = _snapshot_0["revision"];
  const _batch_0 = _snapshot_0["batch"];
  const _active_0 = _snapshot_0["active"];
  const _time_0 = _snapshot_0["time"];
  return run_jump($progress$retire$, [{$: "Replica"}, _revision_0, _batch_0, _active_0, _time_0, _observed_0, _batches_0]);
}

function $replay$append$(_terminal_0, _valid_0, _events_0, _reasoning_0, _next_0) {
  if (_terminal_0) {
    return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Open"}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "Reject", ["reason"]: {$: "TerminalAlreadyPresent"}}};
  } else {
    if (!_valid_0) {
      return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Open"}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "Reject", ["reason"]: {$: "TerminalNotLast"}}};
    } else {
      return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Open"}, ["events"]: run_loop($List$append$(_events_0, _next_0)), ["reasoning"]: _reasoning_0}, ["effect"]: {$: "Appended"}};
    }
  }
}

function $replay$domain$well_formed$(_events_0) {
  if (_events_0.$ === "Nil") {
    return true;
  } else {
    const _t_0 = _events_0["head"];
    const _kind_0 = _t_0["kind"];
    const _payload_0 = _t_0["payload"];
    const _rest_0 = _events_0["tail"];
    const _x_0 = run_loop($Bool$not$(run_loop($replay$domain$terminal$(_kind_0))));
    const _x_1 = run_loop($replay$domain$is_empty$(_rest_0));
    return run_jump($Bool$and$, [(_x_0 || _x_1), run_loop($replay$domain$well_formed$(_rest_0))]);
  }
}

function $replay$reason$(_terminal_0, _events_0, _reasoning_0, _parts_0) {
  if (_terminal_0) {
    return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Open"}, ["events"]: _events_0, ["reasoning"]: _reasoning_0}, ["effect"]: {$: "Reject", ["reason"]: {$: "TerminalAlreadyPresent"}}};
  } else {
    return {$: "Decision", ["state"]: {$: "Journal", ["status"]: {$: "Open"}, ["events"]: _events_0, ["reasoning"]: run_loop($List$append$(_reasoning_0, _parts_0))}, ["effect"]: {$: "ReasonRecorded"}};
  }
}

function $String$cmp$rec$(_h1b_0, _h2b_0, _rr_0) {
  const _t_0 = _rr_0["fst"];
  const _t1b_0 = _t_0["fst"];
  const _t2b_0 = _t_0["snd"];
  const _r_0 = _rr_0["snd"];
  return {$: "Tuple", ["fst"]: {$: "Tuple", ["fst"]: (_h1b_0 + _t1b_0), ["snd"]: (_h2b_0 + _t2b_0)}, ["snd"]: _r_0};
}

function $String$order$fin$(_r_0) {
  const _ab_0 = _r_0["fst"];
  const _c_0 = _r_0["snd"];
  return _c_0;
}

function $observation$stable$(_same_0, _clock_ordered_0, _elapsed_0, _revision_0, _baseline_0, _signature_0, _since_0, _now_0) {
  if (_same_0) {
    if (_clock_ordered_0) {
      return run_jump($observation$promote$, [_elapsed_0, {$: "Candidate", ["revision"]: _revision_0, ["baseline"]: _baseline_0, ["signature"]: _signature_0, ["since"]: _since_0}]);
    } else {
      return {$: "Decision", ["state"]: {$: "Candidate", ["revision"]: _revision_0, ["baseline"]: _baseline_0, ["signature"]: _signature_0, ["since"]: _now_0}, ["effect"]: {$: "ObserveOnly"}};
    }
  } else {
    return {$: "Decision", ["state"]: {$: "Candidate", ["revision"]: _revision_0, ["baseline"]: _baseline_0, ["signature"]: _signature_0, ["since"]: _now_0}, ["effect"]: {$: "ObserveOnly"}};
  }
}

function $Nat$is_ge$(_a_0, _b_0) {
  return run_jump($Cmp$is_ge$, [cmp_new(_a_0, _b_0)]);
}

function $broker$table$activity_cons$(_matches_0, _replacement_0, _previous_0, _rest_0, _updated_0) {
  if (_matches_0) {
    return {$: "Con", ["head"]: _replacement_0, ["tail"]: _rest_0};
  } else {
    return {$: "Con", ["head"]: _previous_0, ["tail"]: _updated_0};
  }
}

function $broker$table$invocation_cons$(_matches_0, _replacement_0, _previous_0, _rest_0, _updated_0) {
  if (_matches_0) {
    return {$: "Con", ["head"]: _replacement_0, ["tail"]: _rest_0};
  } else {
    return {$: "Con", ["head"]: _previous_0, ["tail"]: _updated_0};
  }
}

function $broker$domain$invocation_id$(_invocation_0) {
  const _id_0 = _invocation_0["id"];
  const _payload_0 = _invocation_0["payload"];
  const _delivery_0 = _invocation_0["delivery"];
  return _id_0;
}

function $broker$table$deliver_all$(_entries_0) {
  if (_entries_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _entries_0["head"];
    const _id_0 = _t_0["id"];
    const _payload_0 = _t_0["payload"];
    const _delivery_0 = _t_0["delivery"];
    const _rest_0 = _entries_0["tail"];
    return {$: "Con", ["head"]: {$: "Invocation", ["id"]: _id_0, ["payload"]: _payload_0, ["delivery"]: run_loop($broker$table$deliver$(_delivery_0))}, ["tail"]: run_loop($broker$table$deliver_all$(_rest_0))};
  }
}

function $progress$touch$(_previous_0, _now_0) {
  if (_previous_0.$ === "None") {
    return {$: "Some", ["value"]: _now_0};
  } else {
    const _old_0 = _previous_0["value"];
    return {$: "Some", ["value"]: run_loop($theory$nat$maximum$maximum$(_old_0, _now_0))};
  }
}

function $progress$import_order$(_order_0, _old_0, _next_0, _observed_0, _batches_0) {
  if (_order_0.$ === "LT") {
    return {$: "Decision", ["state"]: {$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: _old_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, ["effect"]: {$: "FrameIgnored"}};
  } else if (_order_0.$ === "EQ") {
    return run_jump($progress$same_frame$, [run_loop($progress$frame_equal$(_old_0, _next_0)), {$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: _old_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}]);
  } else {
    return run_jump($progress$accept_frame$, [run_loop($progress$forward$(_old_0, _next_0)), _old_0, _next_0, _observed_0, _batches_0]);
  }
}

function $progress$domain$revision$(_snapshot_0) {
  const _revision_0 = _snapshot_0["revision"];
  const _batch_0 = _snapshot_0["batch"];
  const _active_0 = _snapshot_0["active"];
  const _time_0 = _snapshot_0["time"];
  return _revision_0;
}

function $replay$domain$is_empty$(_events_0) {
  if (_events_0.$ === "Nil") {
    return true;
  } else {
    const _head_0 = _events_0["head"];
    const _tail_0 = _events_0["tail"];
    return false;
  }
}

function $observation$promote$(_ready_0, _state_0) {
  if (!_ready_0) {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "ObserveOnly"}};
  } else {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "CandidateReady"}};
  }
}

function $Cmp$is_ge$(_c_0) {
  if (_c_0.$ === "LT") {
    return false;
  } else if (_c_0.$ === "EQ") {
    return true;
  } else {
    return true;
  }
}

function $broker$table$deliver$(_delivery_0) {
  if (_delivery_0.$ === "Queued") {
    return {$: "Delivered"};
  } else if (_delivery_0.$ === "Delivered") {
    return {$: "Delivered"};
  } else {
    const _digest_0 = _delivery_0["digest"];
    return {$: "Result", ["digest"]: _digest_0};
  }
}

function $theory$nat$maximum$maximum$(_left_0, _right_0) {
  return run_jump($theory$nat$maximum$choose$, [cmp_new(_left_0, _right_0), _left_0, _right_0]);
}

function $progress$same_frame$(_equal_0, _state_0) {
  if (_equal_0) {
    return {$: "Decision", ["state"]: _state_0, ["effect"]: {$: "FrameIgnored"}};
  } else {
    return run_jump($progress$reject$, [_state_0, {$: "ConflictingSnapshot"}]);
  }
}

function $progress$frame_equal$(_a_0, _b_0) {
  const _ar_0 = _a_0["revision"];
  const _ab_0 = _a_0["batch"];
  const _ac_0 = _a_0["active"];
  const _at_0 = _a_0["time"];
  const _br_0 = _b_0["revision"];
  const _bb_0 = _b_0["batch"];
  const _bc_0 = _b_0["active"];
  const _bt_0 = _b_0["time"];
  return run_jump($Bool$and$, [run_loop($Nat$is_eq$(_ar_0, _br_0)), run_loop($Bool$and$(run_loop($Nat$is_eq$(_ab_0, _bb_0)), run_loop($Bool$and$(run_loop($Nat$is_eq$(_ac_0, _bc_0)), run_loop($progress$time_same$(_at_0, _bt_0))))))]);
}

function $progress$accept_frame$(_ordered_0, _old_0, _next_0, _observed_0, _batches_0) {
  if (!_ordered_0) {
    return run_jump($progress$reject$, [{$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: _old_0, ["observed"]: _observed_0, ["batches"]: _batches_0, ["retired"]: false}, {$: "RegressedSnapshot"}]);
  } else {
    return run_jump($progress$accept_snapshot$, [_next_0, _observed_0, _batches_0]);
  }
}

function $progress$forward$(_a_0, _b_0) {
  const _ar_0 = _a_0["revision"];
  const _ab_0 = _a_0["batch"];
  const _ac_0 = _a_0["active"];
  const _at_0 = _a_0["time"];
  const _br_0 = _b_0["revision"];
  const _bb_0 = _b_0["batch"];
  const _bc_0 = _b_0["active"];
  const _bt_0 = _b_0["time"];
  return run_jump($Bool$and$, [run_loop($Nat$is_le$(_ab_0, _bb_0)), run_loop($progress$time_forward$(_at_0, _bt_0))]);
}

function $theory$nat$maximum$choose$(_order_0, _left_0, _right_0) {
  if (_order_0.$ === "LT") {
    return _right_0;
  } else if (_order_0.$ === "EQ") {
    return _left_0;
  } else {
    return _left_0;
  }
}

function $progress$time_same$(_a_0, _b_0) {
  if (_a_0.$ === "None") {
    if (_b_0.$ === "None") {
      return true;
    } else {
      return false;
    }
  } else {
    const _x_0 = _a_0["value"];
    if (_b_0.$ === "Some") {
      const _y_0 = _b_0["value"];
      return run_jump($Nat$is_eq$, [_x_0, _y_0]);
    } else {
      return false;
    }
  }
}

function $progress$accept_snapshot$(_snapshot_0, _observed_0, _batches_0) {
  const _revision_0 = _snapshot_0["revision"];
  const _batch_0 = _snapshot_0["batch"];
  const _active_0 = _snapshot_0["active"];
  const _time_0 = _snapshot_0["time"];
  return {$: "Decision", ["state"]: {$: "Progress", ["role"]: {$: "Replica"}, ["snapshot"]: {$: "Snapshot", ["revision"]: _revision_0, ["batch"]: _batch_0, ["active"]: _active_0, ["time"]: _time_0}, ["observed"]: _observed_0, ["batches"]: {$: "Con", ["head"]: _batch_0, ["tail"]: _batches_0}, ["retired"]: false}, ["effect"]: {$: "ProgressChanged"}};
}

function $progress$time_forward$(_old_0, _next_0) {
  if (_old_0.$ === "None") {
    return true;
  } else {
    const _a_0 = _old_0["value"];
    if (_next_0.$ === "Some") {
      const _b_0 = _next_0["value"];
      return run_jump($Nat$is_le$, [_a_0, _b_0]);
    } else {
      return false;
    }
  }
}

// Cli
// ===

// A JS program runs one thread and no GPU: --threads and --gpu do nothing.
let cli_args = [];

function cli(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--") {
      cli_args.push(...argv.slice(i + 1));
      break;
    } else if (argv[i] === "--help") {
      io_out(1, io_bytes("usage: " + process.argv[1] + "\n"));
      process.exit(0);
    } else if (argv[i] === "--threads" || argv[i] === "--gpu") {
      i += 1;
    } else {
      cli_args.push(argv[i]);
    }
  }
}

// Show
// ====

// char_show: an escape, a \u{hex}, else the code point
function show_chr(c, q) {
  const k = { 10: "n", 9: "t", 13: "r", 0: "0", 92: "\\" }[c]
    ?? (c === q.codePointAt(0) ? q : null);
  return k !== null ? "\\" + k : c < 32 || c === 127
    ? "\\u{" + c.toString(16) + "}" : String.fromCodePoint(c);
}

// A pure main's value as term_show spells it (see show_main); chain is the
// bracket it continues, or 0.
function show_val(D, N, d, v, chain) {
  if (D[d] === 7) {
    const fs = Object.values(typeof v === "boolean"
      ? { $: v ? "True" : "False" } : v);
    let a = d + 3;
    for (; N[D[a]] !== fs[0]; a += 4 + 2 * D[a + 2]) {}
    const o = "{[("[D[a + 3]];
    let s = o === "{" ? fs[0] + "{" : chain === o ? "" : o;
    for (const [j, f] of fs.slice(1).entries()) {
      if (o === "[" ? j === 0 && chain === o : j > 0) {
        s += ", ";
      }
      s += show_val(D, N, D[a + 5 + 2 * j], f, j === 1 && o !== "{" ? o : 0);
    }
    return o === "{" || chain !== o ? s + "}])"[D[a + 3]] : s;
  }
  return D[d] === 0 ? String(v)
    : D[d] === 1 ? f32_show(v).replace(/^-?\d+(?=e|$)/, "$&.0")
    : D[d] === 2 ? v + "n"
    : D[d] === 3 ? "'" + show_chr(v.codePointAt(0), "'") + "'"
    : D[d] === 4 ? "\"" + [...v].map((c) =>
      show_chr(c.codePointAt(0), "\"")).join("") + "\""
    : D[d] === 5 ? "{==}"
    : "[" + v.map((x) => show_val(D, N, D[d + 1], x, 0)).join(", ") + "]";
}

// Io
// ==

function io_exit(main, show) {
  try {
    if (show !== null) {
      io_out(1, io_bytes(show_val(...show, 0, run_loop(main()), 0) + "\n"));
      process.exit(0);
    }
    process.exit(io_run(main));
  } catch (e) {
    io_errs(String(e));
    process.exit(1);
  }
}

function io_out(fd, data) {
  const fs = require("fs");
  let at = 0;
  while (at < data.length) {
    try {
      at += fs.writeSync(fd, data, at, data.length - at);
    } catch (e) {
      if (e.code === "EAGAIN" || e.code === "EINTR") {
        continue;
      }
      try {
        fs.writeSync(2, "bend: a short write on a standard stream\n");
      } catch (o) {
      }
      process.exit(1);
    }
  }
}

function io_errs(message) {
  io_out(2, io_bytes(message + "\n"));
}

function io_sys() {
  if (globalThis.BEND_SYS === undefined) {
    const ffi = require("bun:ffi");
    const mac = process.platform === "darwin";
    const err = mac ? "__error" : "__errno_location";
    // Darwin's extended select supports high fds.
    const sel = mac ? "select$DARWIN_EXTSN" : "select";
    const T = { i: "i32", u: "u32", U: "u64", I: "i64", p: "ptr",
      c: "cstring" };
    // Apple arm64 passes variadic fcntl flags on the stack: use the ninth
    // fixed argument (the third elsewhere).
    const vari = mac && process.arch === "arm64";
    const lib = ffi.dlopen(mac ? "libSystem.dylib" : "libc.so.6",
      Object.fromEntries(("socket:iii>i bind:ipu>i listen:ii>i connect:ipu>i"
        + " accept:ipp>i send:ipUi>I recv:ipUi>I read:ipU>I pread:ipUI>I"
        + " sendto:ipUipu>I recvfrom:ipUipp>I close:i>i setsockopt:iiipu>i"
        + " " + sel + ":ipppp>i"
        + (vari ? " fcntl:iiiiiiiii>i" : " fcntl:iii>i") + " getsockopt:iiipp>i"
        + " strerror:i>c " + err + ":>p").split(" ").map((s) => {
        const [name, args, ret] = s.split(/[:>]/);
        return [name, { args: [...args].map((a) => T[a]), returns: T[ret] }];
      }))).symbols;
    const fcntl = (fd, cmd, arg) => vari
      ? lib.fcntl(fd, cmd, 0, 0, 0, 0, 0, 0, arg)
      : lib.fcntl(fd, cmd, arg);
    globalThis.BEND_SYS = { ...lib, fcntl, select: lib[sel],
      ptr: ffi.ptr, mac,
      errno: () => ffi.read.i32(lib[err](), 0) };
  }
  return globalThis.BEND_SYS;
}

function io_fail(code) {
  return { $: "Fail",
    error: io_tup(code >>> 0, String(io_sys().strerror(code))) };
}

function io_done(value) {
  return { $: "Done", value };
}

function io_tup(...xs) {
  return xs.reduceRight((snd, fst) => ({ $: "Tuple", fst, snd }));
}

function io_bytes(text) {
  return new TextEncoder().encode(text);
}

function io_text(b, n) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(b.subarray(0, n));
}

function io_addr(host, port) {
  const part = host.split(".");
  const deci = (p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) < 256;
  if (port > 65535 || part.length !== 4 || !part.every(deci)) {
    return null;
  }
  const b = new Uint8Array(16);
  const head = io_sys().mac ? [16, 2] : [2, 0];
  b.set([...head, port >> 8, port & 255, ...part.map(Number)]);
  return b;
}

function io_push(fun, arg, fresh) {
  const io = globalThis.BEND_IO;
  io.runs.push({ fun, arg });
  io.live += fresh ? 1 : 0;
}

function io_wait(io) {
  const soon = io.waits.reduce((m, w) => Math.min(m, w.at ?? m), Infinity);
  const ms = soon === Infinity ? -1
    : Math.max(0, Math.ceil(soon - performance.now()));
  const fds = io.waits.filter((w) => w.fd !== undefined);
  const top = fds.reduce((m, w) => Math.max(m, w.fd), 0);
  const len = (top >> 6 << 3) + 8;
  const set = new Uint8Array(2 * len);
  const at = (w) => (w.out ? len : 0) + (w.fd >> 3);
  for (const w of fds) {
    set[at(w)] |= 1 << (w.fd & 7);
  }
  const tv = new BigInt64Array([BigInt(ms / 1000 | 0),
    BigInt(ms % 1000 * 1000)]);
  const sys = io_sys();
  sys.select(top + 1, sys.ptr(set), sys.ptr(set, len), null,
    ms < 0 ? null : sys.ptr(tv));
  const now = performance.now();
  io.waits = io.waits.filter((w) => {
    const ready = w.at <= now || w.fd !== undefined
      && set[at(w)] & 1 << (w.fd & 7);
    if (ready) {
      io_push(io_wake, w, false);
    }
    return !ready;
  });
}

// Resume k with more's value; undefined means re-parked.
function io_wake(w) {
  const x = w.more();
  return x === undefined ? undefined : w.k(x);
}

// Park for read/write (out) or until at (performance.now()); an undefined
// fd or at disables that source.
function io_park_on(fd, out, k, more, at) {
  globalThis.BEND_IO.waits.push({ fd, out, k, more, at });
}

function io_run(m) {
  const io = { runs: [], live: 0, waits: [] };
  globalThis.BEND_IO = io;
  try {
    io_push(run_loop(m()), (x) => ({ $: "Emit", value: x }), true);
    for (;;) {
      if (io.runs.length === 0) {
        if (io.live === 0) {
          return 0;
        }
        if (io.waits.length === 0) {
          io_errs("bend: deadlock: every computation waits on a channel");
          return 1;
        }
        io_wait(io);
        continue;
      }
      const s = io.runs.shift();
      let op = s.fun(s.arg);
      while (op !== undefined) {
        if (op.$ === "Emit") {
          io.live -= 1;
          break;
        }
        if (op.$ === "Halt") {
          io_errs(op.message);
          return op.code;
        }
        const need = op.need?.() ?? {};
        if (need.time || need.read) {
          const more = () => op.run(...op.args, op.kont);
          io_park_on(need.read ? op.args[0] : undefined, false, op.kont, more,
            need.read ? undefined : performance.now() + Number(op.args[0]));
          break;
        }
        const x = op.run(...op.args, op.kont);
        if (x === undefined) {
          break;
        }
        op = op.kont(x);
      }
    }
  } catch (req) {
    if (req instanceof RangeError) {
      throw "bend: memory fault (machine stack overflow?)";
    }
    if (req?.$ !== "$FFI") {
      throw req;
    }
    io_errs("bend: runtime fail-stop");
    return 1;
  }
}

module.exports = Object.freeze({
  turnStep: run_lib($turn_step$, 2),
  historyPlan: run_lib($history_plan$, 4),
  historySelect: run_lib($history_select$, 3),
  transcriptItem: run_lib($transcript_item$, 2),
  surfaceResume: run_lib($surface_resume$, 1),
  leaseFinish: run_lib($lease_finish$, 6),
  leaseAttach: run_lib($lease_attach$, 3),
  batchInitialize: run_lib($batch_initialize$, 0),
  batchRestore: run_lib($batch_restore$, 1),
  batchPlan: run_lib($batch_plan$, 2),
  batchStep: run_lib($batch_step$, 2),
  batchAck: run_lib($batch_ack$, 2),
  batchClaim: run_lib($batch_claim$, 1),
  observationInitialize: run_lib($observation_initialize$, 0),
  observationStep: run_lib($observation_step$, 2),
  observationEligible: run_lib($observation_eligible$, 1),
  brokerInitialize: run_lib($broker_initialize$, 1),
  brokerStep: run_lib($broker_step$, 2),
  brokerRun: run_lib($broker_run$, 2),
  progressInitialize: run_lib($progress_initialize$, 1),
  progressStep: run_lib($progress_step$, 2),
  progressRun: run_lib($progress_run$, 2),
  progressValid: run_lib($progress_valid$, 1),
  outboxInitialize: run_lib($outbox_initialize$, 0),
  outboxStep: run_lib($outbox_step$, 2),
  outboxContains: run_lib($outbox_contains$, 2),
  outboxRun: run_lib($outbox_run$, 2),
  replayInitialize: run_lib($replay_initialize$, 0),
  replayStep: run_lib($replay_step$, 2),
  replayClosed: run_lib($replay_closed$, 1),
  replayTerminal: run_lib($replay_terminal$, 1),
  replayRun: run_lib($replay_run$, 2),
  phases: Object.freeze(["Fresh", "Prepared", "Attempted", "Running", "Unknown", "Completed", "Cancelled"]),
  events: Object.freeze(["Prepare", "Submit", "Accepted", "Finished", "Uncertain", "Attach", "Detach", "Recover", "UserCancel"]),
  effects: Object.freeze(["PrepareSurface", "SendPrompt", "ObserveOnly", "PublishFinal", "ReplayFinal", "StopByUser", "NoEffect", "Reject"]),
  fingerprint: "b9b26e3b39f414908c60c410a7b97348734eefa7d745219729da9180e300598d",
});
