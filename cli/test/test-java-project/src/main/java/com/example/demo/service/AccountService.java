package com.example.demo.service;

import com.example.demo.model.User;
import com.example.demo.model.Product;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class AccountService {

    private Map<Long, User> users = new HashMap<>();


    public User getUserById(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("ID must not be null");
        }
        
        if (!users.containsKey(userId)) {
            throw new NoSuchElementException("No user found for id: " + userId);
        }
        
        return users.get(userId);
    }

    public String getUserFromJwtToken(String jwtToken) {
        if (jwtToken == null || jwtToken.trim().isEmpty()) {
            throw new IllegalArgumentException("Token cannot be empty");
        }
        
        try {
            String[] tokenParts = jwtToken.split("\\.");
            
            if (tokenParts.length < 2) {
                return null;
            }
            
            String encodedPayload = tokenParts[1];
            String payloadJson = new String(Base64.getUrlDecoder().decode(encodedPayload));
            
            Map<String, Object> claims = parseJson(payloadJson);
            
            Object userIdObj = claims.get("userId");
            return userIdObj != null ? userIdObj.toString() : null;
            
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse JWT token", e);
        }
    }

    private Map<String, Object> parseJson(String json) {
        Map<String, Object> result = new HashMap<>();
        
        json = json.trim().replaceAll("^\\{|\\}$", "");
        String[] pairs = json.split(",");
        
        for (String pair : pairs) {
            String[] keyValue = pair.split(":", 2);
            if (keyValue.length == 2) {
                String key = keyValue[0].trim().replaceAll("\"", "");
                String value = keyValue[1].trim().replaceAll("\"", "");
                result.put(key, value);
            }
        }
        
        return result;
    }

    public Product getProductById(Long productId) {
        if (productId == null) {
            throw new IllegalArgumentException("Product ID cannot be null");
        }
        
        List<Product> products = Arrays.asList(
            new Product(1L, "Laptop", 999.99),
            new Product(2L, "Mouse", 29.99),
            new Product(3L, "Keyboard", 79.99)
        );
        
        return products.stream()
            .filter(p -> p.getId().equals(productId))
            .findFirst()
            .orElseThrow(() -> new NoSuchElementException("Product not found"));
    }
}
