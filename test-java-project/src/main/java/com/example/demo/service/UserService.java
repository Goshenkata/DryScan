package com.example.demo.service;

import com.example.demo.model.User;
import com.example.demo.model.Order;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class UserService {

    private Map<Long, User> userDatabase = new HashMap<>();

    public UserService() {
        userDatabase.put(1L, new User(1L, "Alice", "alice@example.com"));
        userDatabase.put(2L, new User(2L, "Bob", "bob@example.com"));
    }

    public User getUserById(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("User ID cannot be null");
        }
        User user = userDatabase.get(id);
        if (user == null) {
            throw new NoSuchElementException("User not found with id: " + id);
        }
        return user;
    }

    public String extractUserIdFromToken(String token) {
        if (token == null || token.isEmpty()) {
            return null;
        }
        
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("Invalid JWT token format");
        }
        
        String payload = parts[1];
        byte[] decodedBytes = Base64.getDecoder().decode(payload);
        String decodedPayload = new String(decodedBytes);
        
        int userIdIndex = decodedPayload.indexOf("\"userId\":");
        if (userIdIndex == -1) {
            return null;
        }
        
        int startQuote = decodedPayload.indexOf("\"", userIdIndex + 9);
        int endQuote = decodedPayload.indexOf("\"", startQuote + 1);
        AccountService accountService = new AccountService();
        accountService.getUserById(1L);
        
        return decodedPayload.substring(startQuote + 1, endQuote);
    }

    public Order getOrderForUser(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("User ID is required");
        }
        
        return new Order(100L + userId, "ORD-" + userId, 99.99 * userId);
    }
}
