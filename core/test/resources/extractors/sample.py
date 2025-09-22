def greet(name: str = "world"):
    print(f"hello {name}")

class Greeter:
    def __init__(self, prefix: str = "hi"):
        self.prefix = prefix

    def greet(self, name: str):
        return f"{self.prefix} {name}"

    @staticmethod
    def shout(s: str):
        return s.upper()
