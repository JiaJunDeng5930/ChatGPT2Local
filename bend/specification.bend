import Base
import ./domain.bend as D

# Independent, event-oriented requirements. This module must not import kernel.
def prepare(s: D.Phase) -> D.Decision:
  match s:
    case D.Fresh{}: D.Decision{D.Prepared{}, D.PrepareSurface{}}
    case D.Prepared{}: D.Decision{D.Prepared{}, D.Reject{}}
    case D.Attempted{}: D.Decision{D.Attempted{}, D.Reject{}}
    case D.Running{}: D.Decision{D.Running{}, D.Reject{}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.Reject{}}
    case D.Completed{}: D.Decision{D.Completed{}, D.Reject{}}
    case D.Cancelled{}: D.Decision{D.Cancelled{}, D.Reject{}}

def submit(s: D.Phase) -> D.Decision:
  match s:
    case D.Fresh{}: D.Decision{D.Fresh{}, D.Reject{}}
    case D.Prepared{}: D.Decision{D.Attempted{}, D.SendPrompt{}}
    case D.Attempted{}: D.Decision{D.Attempted{}, D.Reject{}}
    case D.Running{}: D.Decision{D.Running{}, D.Reject{}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.Reject{}}
    case D.Completed{}: D.Decision{D.Completed{}, D.Reject{}}
    case D.Cancelled{}: D.Decision{D.Cancelled{}, D.Reject{}}

def accepted(s: D.Phase) -> D.Decision:
  match s:
    case D.Fresh{}: D.Decision{D.Fresh{}, D.Reject{}}
    case D.Prepared{}: D.Decision{D.Prepared{}, D.Reject{}}
    case D.Attempted{}: D.Decision{D.Running{}, D.ObserveOnly{}}
    case D.Running{}: D.Decision{D.Running{}, D.ObserveOnly{}}
    case D.Unknown{}: D.Decision{D.Running{}, D.ObserveOnly{}}
    case D.Completed{}: D.Decision{D.Completed{}, D.NoEffect{}}
    case D.Cancelled{}: D.Decision{D.Cancelled{}, D.NoEffect{}}

def finished(s: D.Phase) -> D.Decision:
  match s:
    case D.Fresh{}: D.Decision{D.Fresh{}, D.Reject{}}
    case D.Prepared{}: D.Decision{D.Prepared{}, D.Reject{}}
    case D.Attempted{}: D.Decision{D.Completed{}, D.PublishFinal{}}
    case D.Running{}: D.Decision{D.Completed{}, D.PublishFinal{}}
    case D.Unknown{}: D.Decision{D.Completed{}, D.PublishFinal{}}
    case D.Completed{}: D.Decision{D.Completed{}, D.ReplayFinal{}}
    case D.Cancelled{}: D.Decision{D.Cancelled{}, D.NoEffect{}}

def uncertain(s: D.Phase) -> D.Decision:
  match s:
    case D.Fresh{}: D.Decision{D.Fresh{}, D.NoEffect{}}
    case D.Prepared{}: D.Decision{D.Prepared{}, D.NoEffect{}}
    case D.Attempted{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
    case D.Running{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
    case D.Completed{}: D.Decision{D.Completed{}, D.NoEffect{}}
    case D.Cancelled{}: D.Decision{D.Cancelled{}, D.NoEffect{}}

def attach(s: D.Phase) -> D.Decision:
  match s:
    case D.Fresh{}: D.Decision{D.Fresh{}, D.NoEffect{}}
    case D.Prepared{}: D.Decision{D.Prepared{}, D.NoEffect{}}
    case D.Attempted{}: D.Decision{D.Attempted{}, D.ObserveOnly{}}
    case D.Running{}: D.Decision{D.Running{}, D.ObserveOnly{}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}
    case D.Completed{}: D.Decision{D.Completed{}, D.ReplayFinal{}}
    case D.Cancelled{}: D.Decision{D.Cancelled{}, D.Reject{}}

def cancel(s: D.Phase) -> D.Decision:
  match s:
    case D.Fresh{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
    case D.Prepared{}: D.Decision{D.Cancelled{}, D.NoEffect{}}
    case D.Attempted{}: D.Decision{D.Cancelled{}, D.StopByUser{}}
    case D.Running{}: D.Decision{D.Cancelled{}, D.StopByUser{}}
    case D.Unknown{}: D.Decision{D.Cancelled{}, D.StopByUser{}}
    case D.Completed{}: D.Decision{D.Completed{}, D.NoEffect{}}
    case D.Cancelled{}: D.Decision{D.Cancelled{}, D.NoEffect{}}

def step(e: D.Event, s: D.Phase) -> D.Decision:
  match e:
    case D.Prepare{}: prepare(s)
    case D.Submit{}: submit(s)
    case D.Accepted{}: accepted(s)
    case D.Finished{}: finished(s)
    case D.Uncertain{}: uncertain(s)
    case D.Attach{}: attach(s)
    case D.Detach{}: D.Decision{s, D.NoEffect{}}
    case D.Recover{}: uncertain(s)
    case D.UserCancel{}: cancel(s)

def transition(s: D.Phase, e: D.Event) -> D.Decision:
  step(e, s)
