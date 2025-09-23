public class Sample {
  @SuppressWarnings("unused")
  private int value;

  public Sample() {
    this.value = 0;
  }

  public void hello() {
    System.out.println("hi");
  }

  public int sum(int a, int b) {
    return a + b;
  }

  public int sum(int a, int b, int c) {
    return a + b + c;
  }

  public static String util(String s) {
    return s.toUpperCase();
  }
}
