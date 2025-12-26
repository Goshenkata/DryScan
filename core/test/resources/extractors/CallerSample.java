public class CallerSample {
  
  private int helperMethod() {
    return 10;
  }

  public int callsHelper() {
    return helperMethod() * 2;
  }

  public int callsMultiple() {
    int a = helperMethod();
    int b = callsHelper();
    return a + b;
  }

  public void standalone() {
    System.out.println("No calls here");
  }
}
