#include <Arduino.h>
#include <SoftwareSerial.h>
#include <string.h>

const byte BUTTON_PIN = 2;
const byte BUZZER_PIN = 8;
const byte LED_PIN = 13;

// RX chân 10, TX chân 11
SoftwareSerial espSerial(10, 11);

bool isMuted = false;
bool lastReading = HIGH;
bool stableButton = HIGH;

unsigned long changedAt = 0;
unsigned long ringStartedAt = 0;

bool ringing = false;
byte soundPhase = 0;

char espLine[24];
char usbLine[24];
byte espLength = 0;
byte usbLength = 0;
bool espOverflow = false;
bool usbOverflow = false;

void applyCommand(const char *command) {
  if (strcmp(command, "MUTE") == 0) {
    isMuted = true;
    noTone(BUZZER_PIN);
    soundPhase = 0;
    Serial.println("MUTE");
  } else if (strcmp(command, "UNMUTE") == 0) {
    isMuted = false;
    Serial.println("UNMUTE");
  }
}

void readCommands(
  Stream &port,
  char *buffer,
  byte &length,
  bool &overflow
) {
  while (port.available()) {
    char c = port.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      buffer[length] = '\0';

      if (!overflow) {
        applyCommand(buffer);
      }

      length = 0;
      overflow = false;
    } else if (!overflow) {
      if (length < 23) {
        buffer[length++] = c;
      } else {
        overflow = true;
      }
    }
  }
}

void startRing(unsigned long now) {
  // Vẫn báo lần bấm khi còi đang bị tắt
  espSerial.println("RING");
  Serial.println("RING");

  noTone(BUZZER_PIN);
  ringStartedAt = now;
  ringing = true;
  digitalWrite(LED_PIN, HIGH);

  soundPhase = isMuted ? 0 : 1;

  if (!isMuted) {
    tone(BUZZER_PIN, 1000);
  }
}

void updateSound(unsigned long now) {
  if (!ringing) {
    return;
  }

  unsigned long elapsed = now - ringStartedAt;

  if (elapsed >= 700) {
    noTone(BUZZER_PIN);
    digitalWrite(LED_PIN, LOW);
    ringing = false;
    soundPhase = 0;
  } else if (
    !isMuted &&
    soundPhase == 1 &&
    elapsed >= 250
  ) {
    noTone(BUZZER_PIN);
    soundPhase = 2;
  }

  if (
    !isMuted &&
    soundPhase == 2 &&
    elapsed >= 300 &&
    elapsed < 700
  ) {
    tone(BUZZER_PIN, 800);
    soundPhase = 3;
  }
}

void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
}

void loop() {
  readCommands(
    espSerial, espLine, espLength, espOverflow
  );

  readCommands(
    Serial, usbLine, usbLength, usbOverflow
  );

  unsigned long now = millis();
  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastReading) {
    changedAt = now;
  }

  // Chống dội nút 50 ms
  if (
    now - changedAt >= 50 &&
    reading != stableButton
  ) {
    stableButton = reading;

    if (stableButton == LOW) {
      startRing(now);
    }
  }

  lastReading = reading;
  updateSound(now);
}