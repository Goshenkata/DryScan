package com.example.demo.model;

public class Order {
    private Long id;
    private String orderNumber;
    private Double total;

    public Order(Long id, String orderNumber, Double total) {
        this.id = id;
        this.orderNumber = orderNumber;
        this.total = total;
    }

    public Long getId() { return id; }
    public String getOrderNumber() { return orderNumber; }
    public Double getTotal() { return total; }
}
