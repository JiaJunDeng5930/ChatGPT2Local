import Base

# A request names its predecessor; neither history search nor model routing is
# part of admission. The host reads these facts inside its SQLite transaction.
type Key is Data:
  FreshKey{}
  RepeatedKey{}
  ConflictingKey{}

type Parent is Data:
  Root{}
  Missing{}
  Pending{}
  Calls{}
  Answered{}
  Claimed{}
  Unavailable{}

type Input is Data:
  Messages{}
  Results{}

type Reason is Data:
  KeyConflict{}
  PreviousMissing{}
  PreviousPending{}
  PreviousConsumed{}
  PreviousUnavailable{}
  MessagesRequired{}
  ResultsRequired{}

type Admission is Data:
  NewPage{}
  Replay{}
  Append{}
  DeliverResults{}
  Denied{reason: Reason}
