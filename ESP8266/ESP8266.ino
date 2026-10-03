#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <FirebaseESP8266.h>
#include <SoftwareSerial.h>
#include <string.h>
#include "wifi_config.h"

// ESP RX D1 nhận từ Uno TX chân 11
// ESP TX D2 gửi đến Uno RX chân 10
SoftwareSerial unoSerial(D1, D2);

FirebaseData streamData;
FirebaseData writeData;
FirebaseAuth auth;
FirebaseConfig config;

bool streamStarted = false;
bool pendingRing = false;

bool muteKnown = false;
bool currentMute = false;

unsigned long streamAttemptAt = 0;
unsigned long writeAttemptAt = 0;
unsigned long muteSentAt = 0;

bool triedStream = false;
bool triedWrite = false;

char uartLine[24];
byte uartLength = 0;
bool uartOverflow = false;

void readUno() {
  while (unoSerial.available()) {
    char c = unoSerial.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      uartLine[uartLength] = '\0';

      if (
        !uartOverflow &&
        strcmp(uartLine, "RING") == 0
      ) {
        pendingRing = true;
        triedWrite = false;
      }

      uartLength = 0;
      uartOverflow = false;
    } else if (!uartOverflow) {
      if (uartLength < 23) {
        uartLine[uartLength++] = c;
      } else {
        uartOverflow = true;
      }
    }
  }
}

void sendMute() {
  unoSerial.println(
    currentMute ? "MUTE" : "UNMUTE"
  );

  muteSentAt = millis();
}

void setup() {
  Serial.begin(9600);
  unoSerial.begin(9600);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Firebase chung của đồ án
  config.database_url =
    "https://iot-doorbell-9869d-default-rtdb."
    "asia-southeast1.firebasedatabase.app";

  // Dùng quyền demo đã cấp riêng cho /doorbell
  config.signer.test_mode = true;

  streamData.setBSSLBufferSize(4096, 1024);
  writeData.setBSSLBufferSize(4096, 1024);

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
}

void loop() {
  readUno();

  unsigned long now = millis();

  // Gửi lại trạng thái để đồng bộ nếu Uno khởi động lại
  if (muteKnown && now - muteSentAt >= 2000) {
    sendMute();
  }

  if (
    WiFi.status() != WL_CONNECTED ||
    !Firebase.ready()
  ) {
    yield();
    return;
  }

  // Thử mở stream, thử lại sau 5 giây nếu thất bại
  if (
    !streamStarted &&
    (!triedStream || now - streamAttemptAt >= 5000)
  ) {
    triedStream = true;
    streamAttemptAt = now;

    streamStarted = Firebase.beginStream(
      streamData,
      "/doorbell/mute"
    );

    if (!streamStarted) {
      Serial.println(streamData.errorReason());
    }
  }

  if (streamStarted) {
    if (!Firebase.readStream(streamData)) {
      Serial.println(streamData.errorReason());
    }

    if (
      streamData.streamAvailable() &&
      streamData.dataType() == "boolean"
    ) {
      currentMute = streamData.boolData();
      muteKnown = true;
      sendMute();
    }
  }

  readUno();
  now = millis();

  // Ghi lần bấm đang chờ, thử lại nếu ghi thất bại
  if (
    pendingRing &&
    (!triedWrite || now - writeAttemptAt >= 2000)
  ) {
    triedWrite = true;
    writeAttemptAt = now;

    FirebaseJson patch;
    patch.set("ring", true);

    // Thời gian do server Firebase cung cấp
    patch.set("lastRingAt/.sv", "timestamp");

    // Chỉ cập nhật ring và lastRingAt
    // Giữ nguyên mute và muteRequestedAt
    if (
      Firebase.updateNode(
        writeData,
        "/doorbell",
        patch
      )
    ) {
      pendingRing = false;
      Serial.println("RING saved");
    } else {
      Serial.println(writeData.errorReason());
    }
  }

  readUno();
  yield();
}