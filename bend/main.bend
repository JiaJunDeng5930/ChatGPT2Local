import Base
import ./native-protocol.bend as P

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(P.command(args))
