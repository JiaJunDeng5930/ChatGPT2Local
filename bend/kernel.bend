import Base
import ./domain.bend as D
import ./theory/transition-system.bend as T

# State-oriented implementation; the proof compares the WHOLE decision with
# the independently event-oriented specification, including rejected commands.
def step(s: D.Phase, e: D.Event) -> D.Decision:
  match s:
    case D.Fresh{}:
      match e:
        case D.Prepare{}: D.Decision{D.Prepared{}, D.PrepareSurface{}}
        case D.Submit{}: D.Decision{D.Fresh{}, D.Reject{}}
        case D.Accepted{}: D.Decision{D.Fresh{}, D.Reject{}}
        case D.Finished{}: D.Decision{D.Fresh{}, D.Reject{}}
        case D.Uncertain{}: D.Decision{D.Fresh{}, D.NoEffect{}}
        case D.Attach{}: D.Decision{D.Fresh{}, D.NoEffect{}}
        case D.Detach{}: D.Decision{D.Fresh{}, D.NoEffect{}}
        case D.Recover{}: D.Decision{D.Fresh{}, D.NoEffect{}}
        case D.UserCancel{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
    case D.Prepared{}:
      match e:
        case D.Prepare{}: D.Decision{D.Prepared{}, D.Reject{}}
        case D.Submit{}: D.Decision{D.Attempted{}, D.SendPrompt{}}
        case D.Accepted{}: D.Decision{D.Prepared{}, D.Reject{}}
        case D.Finished{}: D.Decision{D.Prepared{}, D.Reject{}}
        case D.Uncertain{}: D.Decision{D.Prepared{}, D.NoEffect{}}
        case D.Attach{}: D.Decision{D.Prepared{}, D.NoEffect{}}
        case D.Detach{}: D.Decision{D.Prepared{}, D.NoEffect{}}
        case D.Recover{}: D.Decision{D.Prepared{}, D.NoEffect{}}
        case D.UserCancel{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
    case D.Attempted{}:
      match e:
        case D.Prepare{}: D.Decision{D.Attempted{}, D.Reject{}}
        case D.Submit{}: D.Decision{D.Attempted{}, D.Reject{}}
        case D.Accepted{}: D.Decision{D.Running{}, D.ObserveOnly{}}
        case D.Finished{}: D.Decision{D.Completed{}, D.PublishFinal{}}
        case D.Uncertain{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
        case D.Attach{}: D.Decision{D.Attempted{}, D.ObserveOnly{}}
        case D.Detach{}: D.Decision{D.Attempted{}, D.NoEffect{}}
        case D.Recover{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
        case D.UserCancel{}: D.Decision{D.Cancelled{}, D.StopByUser{}}
    case D.Running{}:
      match e:
        case D.Prepare{}: D.Decision{D.Running{}, D.Reject{}}
        case D.Submit{}: D.Decision{D.Running{}, D.Reject{}}
        case D.Accepted{}: D.Decision{D.Running{}, D.ObserveOnly{}}
        case D.Finished{}: D.Decision{D.Completed{}, D.PublishFinal{}}
        case D.Uncertain{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
        case D.Attach{}: D.Decision{D.Running{}, D.ObserveOnly{}}
        case D.Detach{}: D.Decision{D.Running{}, D.NoEffect{}}
        case D.Recover{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
        case D.UserCancel{}: D.Decision{D.Cancelled{}, D.StopByUser{}}
    case D.Unknown{}:
      match e:
        case D.Prepare{}: D.Decision{D.Unknown{}, D.Reject{}}
        case D.Submit{}: D.Decision{D.Unknown{}, D.Reject{}}
        case D.Accepted{}: D.Decision{D.Running{}, D.ObserveOnly{}}
        case D.Finished{}: D.Decision{D.Completed{}, D.PublishFinal{}}
        case D.Uncertain{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
        case D.Attach{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
        case D.Detach{}: D.Decision{D.Unknown{}, D.NoEffect{}}
        case D.Recover{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
        case D.UserCancel{}: D.Decision{D.Cancelled{}, D.StopByUser{}}
    case D.Completed{}:
      match e:
        case D.Prepare{}: D.Decision{D.Completed{}, D.Reject{}}
        case D.Submit{}: D.Decision{D.Completed{}, D.Reject{}}
        case D.Accepted{}: D.Decision{D.Completed{}, D.NoEffect{}}
        case D.Finished{}: D.Decision{D.Completed{}, D.ReplayFinal{}}
        case D.Uncertain{}: D.Decision{D.Completed{}, D.NoEffect{}}
        case D.Attach{}: D.Decision{D.Completed{}, D.ReplayFinal{}}
        case D.Detach{}: D.Decision{D.Completed{}, D.NoEffect{}}
        case D.Recover{}: D.Decision{D.Completed{}, D.NoEffect{}}
        case D.UserCancel{}: D.Decision{D.Completed{}, D.NoEffect{}}
    case D.Cancelled{}:
      match e:
        case D.Prepare{}: D.Decision{D.Cancelled{}, D.Reject{}}
        case D.Submit{}: D.Decision{D.Cancelled{}, D.Reject{}}
        case D.Accepted{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
        case D.Finished{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
        case D.Uncertain{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
        case D.Attach{}: D.Decision{D.Cancelled{}, D.Reject{}}
        case D.Detach{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
        case D.Recover{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
        case D.UserCancel{}: D.Decision{D.Cancelled{}, D.NoEffect{}}

def run(events: List<&2, D.Event>, state: D.Phase) -> List<&2, D.Decision>:
  T.run(~D.Phase, ~D.Event, ~D.Decision, ~step, ~D.phase, events, state)
