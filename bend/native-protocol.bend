import Base
import ./domain.bend as D
import ./api.bend as API
def decode_phase(n: Nat) -> Maybe<D.Phase>:
  match n:
    case 0n: Some{D.Fresh{}}
    case 1n: Some{D.Prepared{}}
    case 2n: Some{D.Attempted{}}
    case 3n: Some{D.Running{}}
    case 4n: Some{D.Unknown{}}
    case 5n: Some{D.Completed{}}
    case 6n: Some{D.Cancelled{}}
    case _: None{}

def decode_event(n: Nat) -> Maybe<D.Event>:
  match n:
    case 0n: Some{D.Prepare{}}
    case 1n: Some{D.Submit{}}
    case 2n: Some{D.Accepted{}}
    case 3n: Some{D.Finished{}}
    case 4n: Some{D.Uncertain{}}
    case 5n: Some{D.Attach{}}
    case 6n: Some{D.Detach{}}
    case 7n: Some{D.Recover{}}
    case 8n: Some{D.UserCancel{}}
    case _: None{}

def phase_name(s: D.Phase) -> String:
  match s:
    case D.Fresh{}: "Fresh"
    case D.Prepared{}: "Prepared"
    case D.Attempted{}: "Attempted"
    case D.Running{}: "Running"
    case D.Unknown{}: "Unknown"
    case D.Completed{}: "Completed"
    case D.Cancelled{}: "Cancelled"

def effect_name(e: D.Effect) -> String:
  match e:
    case D.PrepareSurface{}: "PrepareSurface"
    case D.SendPrompt{}: "SendPrompt"
    case D.ObserveOnly{}: "ObserveOnly"
    case D.PublishFinal{}: "PublishFinal"
    case D.ReplayFinal{}: "ReplayFinal"
    case D.StopByUser{}: "StopByUser"
    case D.NoEffect{}: "NoEffect"
    case D.Reject{}: "Reject"

def show_decision(d: D.Decision) -> String:
  match d:
    case D.Decision{s, e}: phase_name(s) ++ ":" ++ effect_name(e)

def evaluate(s: Maybe<D.Phase>, e: Maybe<D.Event>) -> String:
  match s e:
    case Some{state} Some{event}: show_decision(API.turn_step(state, event))
    case _ _: "invalid"

def read_args(s: Maybe<&2, Nat>, e: Maybe<&2, Nat>) -> String:
  match s e:
    case Some{state} Some{event}: evaluate(decode_phase(state), decode_event(event))
    case _ _: "invalid"

def command(args: List<String>) -> String:
  match args:
    case Con{s, Con{e, Nil{}}}: read_args(Nat.read(s), Nat.read(e))
    case _: "usage: verified-core <phase 0..6> <event 0..8>"
