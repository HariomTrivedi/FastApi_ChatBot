#!/usr/bin/env python3

import requests
import json

# Test the friend request API
BASE_URL = "http://localhost:8005"

def test_login(email, password):
    """Login and get token"""
    response = requests.post(f"{BASE_URL}/auth/login", json={
        "email": email,
        "password": password
    })
    if response.status_code == 200:
        return response.json()["access_token"]
    else:
        print(f"Login failed: {response.text}")
        return None

def test_get_active_users(token):
    """Get active users"""
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/auth/users/active", headers=headers)
    print(f"Get active users: {response.status_code}")
    if response.status_code == 200:
        users = response.json()
        print(f"Found {len(users)} active users")
        for user in users:
            print(f"  - {user['username']} (ID: {user['id']})")
        return users
    else:
        print(f"Error: {response.text}")
        return []

def test_send_friend_request(token, receiver_id):
    """Send friend request"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    data = {"receiver_id": receiver_id}
    response = requests.post(f"{BASE_URL}/friends/requests", headers=headers, json=data)
    print(f"Send friend request to {receiver_id}: {response.status_code}")
    if response.status_code == 201:
        print("Friend request sent successfully!")
        return response.json()
    else:
        print(f"Error: {response.text}")
        return None

if __name__ == "__main__":
    # Test with first user (assuming you have users in the database)
    token1 = test_login("test@example.com", "password123")
    if token1:
        users = test_get_active_users(token1)
        if users:
            # Try to send request to first other user
            other_user = users[0]
            test_send_friend_request(token1, other_user["id"])
