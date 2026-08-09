package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// agentSpawner creates one Kubernetes Job per order participant via kubectl.
// The kubeconfig arrives as KUBECONFIG_B64 because the orchestrator runs on Railway.
type agentSpawner struct {
	kubeconfigPath string
	namespace      string
	image          string
	publicURL      string
	slackToken     string
	openRouterKey  string
}

func agentSpawnerFromEnv(ctx context.Context) *agentSpawner {
	encoded := os.Getenv("KUBECONFIG_B64")
	image := os.Getenv("AGENT_IMAGE")
	if encoded == "" || image == "" {
		log.Printf("agent spawner disabled: KUBECONFIG_B64 or AGENT_IMAGE unset")
		return nil
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		log.Printf("agent spawner disabled: decode KUBECONFIG_B64: %v", err)
		return nil
	}
	path := "/tmp/group-grub-kubeconfig"
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		log.Printf("agent spawner disabled: write kubeconfig: %v", err)
		return nil
	}
	spawner := &agentSpawner{
		kubeconfigPath: path,
		namespace:      "default",
		image:          image,
		publicURL:      os.Getenv("ORCHESTRATOR_PUBLIC_URL"),
		slackToken:     os.Getenv("SLACK_BOT_TOKEN"),
		openRouterKey:  os.Getenv("OPEN_ROUTER_KEY"),
	}
	if err := spawner.ensureSecret(ctx); err != nil {
		log.Printf("agent secret ensure failed (jobs may fail to start): %v", err)
	}
	return spawner
}

func (s *agentSpawner) apply(ctx context.Context, manifest string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "kubectl", "--kubeconfig", s.kubeconfigPath, "apply", "-f", "-")
	cmd.Stdin = strings.NewReader(manifest)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("kubectl apply: %v: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (s *agentSpawner) ensureSecret(ctx context.Context) error {
	manifest := fmt.Sprintf(`apiVersion: v1
kind: Secret
metadata:
  name: group-grub-agent
  namespace: %s
stringData:
  SLACK_BOT_TOKEN: %s
  OPENROUTER_API_KEY: %s
`, s.namespace, strconv.Quote(s.slackToken), strconv.Quote(s.openRouterKey))
	return s.apply(ctx, manifest)
}

// spawn creates the agent Job for one participant. Job name fits DNS-1123 (<=63 chars).
func (s *agentSpawner) spawn(ctx context.Context, orderID, slackUserID, dmChannelID string, shareCents int, restaurant string) error {
	compactID := strings.ReplaceAll(orderID, "-", "")
	name := "agent-" + compactID + "-" + strings.ToLower(slackUserID)
	manifest := fmt.Sprintf(`apiVersion: batch/v1
kind: Job
metadata:
  name: %s
  namespace: %s
  labels:
    app: group-grub-agent
    order: %s
spec:
  ttlSecondsAfterFinished: 600
  backoffLimit: 1
  template:
    metadata:
      labels:
        app: group-grub-agent
        order: %s
    spec:
      restartPolicy: Never
      imagePullSecrets:
      - name: rainxyzhackathon2026
      containers:
      - name: agent
        image: %s
        resources:
          requests:
            cpu: 250m
            memory: 512Mi
          limits:
            cpu: "1"
            memory: 1Gi
        env:
        - name: ORDER_ID
          value: %s
        - name: PARTICIPANT_SLACK_ID
          value: %s
        - name: DM_CHANNEL_ID
          value: %s
        - name: SHARE_CENTS
          value: %s
        - name: RESTAURANT
          value: %s
        - name: ORCHESTRATOR_URL
          value: %s
        - name: GOOSE_PROVIDER
          value: "openrouter"
        - name: GOOSE_MODEL
          value: "z-ai/glm-5.2"
        - name: SLACK_BOT_TOKEN
          valueFrom:
            secretKeyRef:
              name: group-grub-agent
              key: SLACK_BOT_TOKEN
        - name: OPENROUTER_API_KEY
          valueFrom:
            secretKeyRef:
              name: group-grub-agent
              key: OPENROUTER_API_KEY
`, name, s.namespace, orderID, orderID, s.image,
		strconv.Quote(orderID), strconv.Quote(slackUserID), strconv.Quote(dmChannelID),
		strconv.Quote(strconv.Itoa(shareCents)), strconv.Quote(restaurant), strconv.Quote(s.publicURL))
	return s.apply(ctx, manifest)
}
