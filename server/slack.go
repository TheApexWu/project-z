package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const defaultOrderTimer = 15 * time.Minute

type slackClient struct {
	token string
	http  *http.Client
}

type beginOrder struct {
	Users       []string `json:"users"`
	BudgetCents int      `json:"budget_cents"`
	Restaurant  string   `json:"restaurant"`
	Timer       string   `json:"timer"`
}

var mentionPattern = regexp.MustCompile(`<@([A-Z0-9]+)(?:\|[^>]+)?>|@([A-Z0-9]+)`)
var budgetPattern = regexp.MustCompile(`\$\s*(\d+(?:\.\d{1,2})?)`)
var timerPattern = regexp.MustCompile(`(?i)\b(\d+)\s*([mh])\b`)

func verifySlackRequest(signingSecret, timestamp, signature string, body []byte, now time.Time) bool {
	if signingSecret == "" || timestamp == "" || signature == "" {
		return false
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || now.Sub(time.Unix(ts, 0)).Abs() > 5*time.Minute {
		return false
	}
	mac := hmac.New(sha256.New, []byte(signingSecret))
	fmt.Fprintf(mac, "v0:%s:%s", timestamp, body)
	want := "v0=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(signature))
}

func (s slackClient) api(ctx context.Context, method string, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://slack.com/api/"+method, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	response, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return fmt.Errorf("Slack %s: %s", method, response.Status)
	}
	var result struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	if !result.OK {
		return fmt.Errorf("Slack %s: %s", method, result.Error)
	}
	if output != nil {
		return json.Unmarshal(data, output)
	}
	return nil
}

func parseBeginOrder(ctx context.Context, text, apiKey string) (beginOrder, error) {
	parsed := parseBeginOrderLocally(text)
	if apiKey == "" {
		return parsed, nil
	}
	prompt := "Interpret this Slack group-food-order command. Return JSON only with users (Slack user IDs), budget_cents (integer), restaurant (string), and timer (Go duration such as 15m). Preserve user IDs exactly. Command: " + text
	payload := map[string]any{"model": "z-ai/glm-5.2", "messages": []map[string]string{{"role": "user", "content": prompt}}, "response_format": map[string]string{"type": "json_object"}}
	body, err := json.Marshal(payload)
	if err != nil {
		return beginOrder{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://openrouter.ai/api/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return beginOrder{}, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return parsed, nil
	}
	defer response.Body.Close()
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if response.StatusCode/100 != 2 || json.NewDecoder(response.Body).Decode(&result) != nil || len(result.Choices) == 0 {
		return parsed, nil
	}
	var assisted beginOrder
	if json.Unmarshal([]byte(result.Choices[0].Message.Content), &assisted) == nil {
		if len(assisted.Users) > 0 && assisted.BudgetCents > 0 && assisted.Restaurant != "" {
			return assisted, nil
		}
	}
	return parsed, nil
}

func parseBeginOrderLocally(text string) beginOrder {
	result := beginOrder{}
	for _, match := range mentionPattern.FindAllStringSubmatch(text, -1) {
		if match[1] != "" {
			result.Users = append(result.Users, match[1])
		} else {
			result.Users = append(result.Users, match[2])
		}
	}
	if match := budgetPattern.FindStringSubmatch(text); len(match) > 1 {
		if amount, err := strconv.ParseFloat(match[1], 64); err == nil {
			result.BudgetCents = int(amount*100 + .5)
		}
	}
	if match := timerPattern.FindStringSubmatch(text); len(match) > 2 {
		result.Timer = strings.ToLower(match[1] + match[2])
	}
	cleaned := mentionPattern.ReplaceAllString(text, "")
	cleaned = budgetPattern.ReplaceAllString(cleaned, "")
	cleaned = timerPattern.ReplaceAllString(cleaned, "")
	result.Restaurant = strings.TrimSpace(cleaned)
	return result
}

func (b beginOrder) duration() (time.Duration, error) {
	if b.Timer == "" {
		return defaultOrderTimer, nil
	}
	return time.ParseDuration(b.Timer)
}

func slackCommandHandler(engine *orderEngine, client slackClient, signingSecret, openRouterKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil || !verifySlackRequest(signingSecret, r.Header.Get("X-Slack-Request-Timestamp"), r.Header.Get("X-Slack-Signature"), body, time.Now()) {
			http.Error(w, "invalid Slack signature", http.StatusUnauthorized)
			return
		}
		form, err := url.ParseQuery(string(body))
		if err != nil || form.Get("command") != "/begin-order" {
			http.Error(w, "unsupported command", http.StatusBadRequest)
			return
		}
		userID := form.Get("user_id")
		var allowed bool
		if err := engine.db.QueryRow(r.Context(), `SELECT can_create_orders FROM admins WHERE slack_user_id = $1`, userID).Scan(&allowed); err != nil || !allowed {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"response_type": "ephemeral", "text": "Only authorized Group Grub admins can begin orders."})
			return
		}
		order, err := parseBeginOrder(r.Context(), form.Get("text"), openRouterKey)
		if err == nil && order.BudgetCents > maxOrderCents {
			err = ErrBudgetExceeded
		}
		timer, timerErr := order.duration()
		if err == nil {
			err = timerErr
		}
		if err == nil && (len(order.Users) == 0 || order.Restaurant == "") {
			err = errors.New("include at least one @user, a dollar budget, and restaurant")
		}
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"response_type": "ephemeral", "text": "Could not start order: " + err.Error()})
			return
		}
		id, err := engine.create(r.Context(), order.BudgetCents, order.Restaurant, order.Users, timer)
		if err == nil {
			err = engine.attachSlack(r.Context(), id, form.Get("channel_id"), client)
		}
		if err != nil {
			logSlackError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"response_type": "ephemeral", "text": "Group order started for " + order.Restaurant + "."})
	}
}

func logSlackError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"response_type": "ephemeral", "text": "Could not start order: " + err.Error()})
}

func slackFromEnv() slackClient {
	return slackClient{token: os.Getenv("SLACK_BOT_TOKEN"), http: &http.Client{Timeout: 10 * time.Second}}
}

func (e *orderEngine) attachSlack(ctx context.Context, orderID, channelID string, client slackClient) error {
	if client.token == "" {
		return errors.New("SLACK_BOT_TOKEN is required")
	}
	if _, err := e.db.Exec(ctx, `UPDATE orders SET channel_id = $2 WHERE id = $1`, orderID, channelID); err != nil {
		return err
	}
	var restaurant string
	if err := e.db.QueryRow(ctx, `SELECT restaurant FROM orders WHERE id = $1`, orderID).Scan(&restaurant); err != nil {
		return err
	}
	var posted struct {
		TS string `json:"ts"`
	}
	blocks, err := e.announcementBlocks(ctx, orderID)
	if err != nil {
		return err
	}
	if err := client.api(ctx, "chat.postMessage", map[string]any{"channel": channelID, "text": "Group Grub order", "blocks": blocks}, &posted); err != nil {
		return err
	}
	if _, err := e.db.Exec(ctx, `UPDATE orders SET announcement_ts = $2 WHERE id = $1`, orderID, posted.TS); err != nil {
		return err
	}
	rows, err := e.db.Query(ctx, `SELECT slack_user_id, share_cents FROM participants WHERE order_id = $1`, orderID)
	if err != nil {
		return err
	}
	type participantDM struct {
		userID string
		share  int
	}
	var participantList []participantDM
	for rows.Next() {
		var p participantDM
		if err := rows.Scan(&p.userID, &p.share); err != nil {
			rows.Close()
			return err
		}
		participantList = append(participantList, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, p := range participantList {
		var dm struct {
			Channel struct {
				ID string `json:"id"`
			} `json:"channel"`
		}
		if err := client.api(ctx, "conversations.open", map[string]string{"users": p.userID}, &dm); err != nil {
			return err
		}
		if _, err := e.db.Exec(ctx, `UPDATE participants SET dm_channel_id = $3 WHERE order_id = $1 AND slack_user_id = $2`, orderID, p.userID, dm.Channel.ID); err != nil {
			return err
		}
		if err := client.api(ctx, "chat.postMessage", map[string]string{"channel": dm.Channel.ID, "text": "A Group Grub order is open. Your ordering assistant will help you build an order within your share."}, nil); err != nil {
			return err
		}
		if e.agents != nil {
			// async: kubectl apply must not blow Slack's 3s command ack window
			go func(userID, dmID string, share int) {
				spawnCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				if err := e.agents.spawn(spawnCtx, orderID, userID, dmID, share, restaurant); err != nil {
					log.Printf("spawn agent for %s on order %s failed: %v", userID, orderID, err)
				}
			}(p.userID, dm.Channel.ID, p.share)
		}
	}
	return nil
}

func (e *orderEngine) announcementBlocks(ctx context.Context, orderID string) ([]map[string]any, error) {
	var restaurant, state string
	var budget int
	var deadline time.Time
	if err := e.db.QueryRow(ctx, `SELECT restaurant, budget_cents, state, COALESCE(grace_deadline, timer_deadline) FROM orders WHERE id = $1`, orderID).Scan(&restaurant, &budget, &state, &deadline); err != nil {
		return nil, err
	}
	rows, err := e.db.Query(ctx, `SELECT slack_user_id, confirmed_at IS NOT NULL FROM participants WHERE order_id = $1 ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var checklist []string
	for rows.Next() {
		var userID string
		var confirmed bool
		if err := rows.Scan(&userID, &confirmed); err != nil {
			return nil, err
		}
		marker := "⏳"
		if confirmed {
			marker = "✅"
		}
		checklist = append(checklist, fmt.Sprintf("%s <@%s>", marker, userID))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	deadlineText := fmt.Sprintf("<!date^%d^{relative}|%s>", deadline.Unix(), deadline.Format(time.RFC822))
	return []map[string]any{
		{"type": "header", "text": map[string]string{"type": "plain_text", "text": "Group Grub order"}},
		{"type": "section", "fields": []map[string]string{{"type": "mrkdwn", "text": "*Restaurant*\n" + restaurant}, {"type": "mrkdwn", "text": fmt.Sprintf("*Budget*\n$%.2f", float64(budget)/100)}}},
		{"type": "section", "text": map[string]string{"type": "mrkdwn", "text": "*Participants*\n" + strings.Join(checklist, "\n")}},
		{"type": "context", "elements": []map[string]string{{"type": "mrkdwn", "text": "*Status:* " + state + " | *Deadline:* " + deadlineText}}},
	}, nil
}

func (e *orderEngine) updateAnnouncement(ctx context.Context, orderID string, client slackClient) error {
	if client.token == "" {
		return nil
	}
	var channelID, ts string
	if err := e.db.QueryRow(ctx, `SELECT channel_id, announcement_ts FROM orders WHERE id = $1`, orderID).Scan(&channelID, &ts); err != nil || channelID == "" || ts == "" {
		return err
	}
	blocks, err := e.announcementBlocks(ctx, orderID)
	if err != nil {
		return err
	}
	return client.api(ctx, "chat.update", map[string]any{"channel": channelID, "ts": ts, "text": "Group Grub order", "blocks": blocks}, nil)
}
