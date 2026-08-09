package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	secret, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(os.Getenv("DOORDASH_SIGNING_SECRET"), "="))
	if err != nil {
		fail("decode DOORDASH_SIGNING_SECRET: %v", err)
	}
	now := time.Now().Unix()
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT", "dd-ver": "DD-JWT-V1"})
	claims, _ := json.Marshal(map[string]any{
		"aud": "doordash", "iss": os.Getenv("DOORDASH_DEVELOPER_ID"), "kid": os.Getenv("DOORDASH_KEY_ID"), "iat": now, "exp": now + 300,
	})
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(unsigned))
	token := unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	req, err := http.NewRequest(http.MethodGet, "https://openapi.doordash.com/drive/v2/deliveries/milestone-0-smoke", nil)
	if err != nil {
		fail("create request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fail("request: %v", err)
	}
	defer resp.Body.Close()
	fmt.Printf("DoorDash status: %d\n", resp.StatusCode)
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		fail("DoorDash authentication was rejected")
	}
}

func fail(format string, args ...any) {
	fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func fprintf(file *os.File, format string, args ...any) {
	_, _ = fmt.Fprintf(file, format, args...)
}
