#include <WiFi.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <HTTPClient.h>      // Untuk komunikasi ke Supabase
#include <ArduinoJson.h>    // Untuk parsing data JSON dari Supabase
#include "PID_v1.h" 

// ===== CONFIG WIFI =====
const char* ssid     = "vick";
const char* password = "telurdadar";

// ===== CONFIG SUPABASE =====
const char* supabase_url = "https://zyogoissymtonfkyjqxf.supabase.co"; 
const char* anon_key     = "sb_publishable_3uDWsaihi6doAxFdmC_VKA_GG-_aD36"; // <-- Ganti dengan milik Anda
const int DEVICE_ID      = 1;
unsigned long lastSupabaseSync = 0;
const unsigned long supabaseInterval = 2000; // Sinkronisasi setiap 1 detik
// Tambahan variabel untuk manajemen waktu kirim data (Non-blocking)
unsigned long lastSyncTime = 0;
const unsigned long syncInterval = 2000; // Kirim & cek data setiap 3 detik sekali

// ===== CONFIG PIN =====
#define DINAMO_PIN   19
#define HEATER_PIN   18
#define DS18B20_PIN  4
#define BUZZER_PIN   5
#define OLED_SDA     21
#define OLED_SCL     22

// ===== CONFIG PWM =====
#define DINAMO_CHANNEL  0
#define HEATER_CHANNEL  1
#define PWM_FREQ        5000
#define PWM_RESOLUTION  8

// ===== CONFIG OLED =====
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
uint8_t oledAddress = 0x3C;

// ===== SENSOR SUHU =====
OneWire         oneWire(DS18B20_PIN);
DallasTemperature sensors(&oneWire);

// ===== CONFIG SUHU ALARM =====
#define SUHU_WARNING  60.0
#define SUHU_DANGER   75.0

// ===== CONFIG PID HEATER =====
double setpointSuhi = 50.0; 
double pidInput, pidOutput;
double Kp = 20.0, Ki = 0.5, Kd = 10.0; 
PID myPID(&pidInput, &pidOutput, &setpointSuhi, Kp, Ki, Kd, DIRECT);

// ===== BUZZER =====
#define BUZZER_BEEP_FAST  200
#define BUZZER_BEEP_SLOW  600

// ===== STATE DINAMO =====
enum DinamoState { DINAMO_OFF, DINAMO_LEVEL1, DINAMO_LEVEL2, DINAMO_LEVEL3 };
DinamoState dinamoState = DINAMO_OFF;

// ===== STATE HEATER =====
enum HeaterState { HEATER_OFF, HEATER_ON };
HeaterState heaterState = HEATER_OFF;

// ===== VARIABEL GLOBAL =====
float          currentTemp      = 0.0;
bool           alarmActive      = false;
bool           overheatShutdown = false;
unsigned long lastTempRead     = 0;
unsigned long lastOledUpdate   = 0;
unsigned long buzzerTimer      = 0;
bool           buzzerState      = false;
bool           oledOK           = false;

// ===== SCAN I2C =====
uint8_t scanI2C() {
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      if (addr == 0x3C || addr == 0x3D) return addr;
    }
  }
  return 0x3C;
}

// ===== UPDATE OLED =====
void updateOLED() {
  if (!oledOK) return;
  display.clearDisplay();

  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(15, 0);
  display.print(" KNEE THERAP SYSTEM "); 
  display.drawLine(0, 10, 127, 10, SH110X_WHITE);

  display.setCursor(0, 13);
  display.print("SUHU:");
  display.setTextSize(2);
  display.setCursor(35, 11);
  if (currentTemp <= -100) {
    display.print("ERROR");
  } else {
    display.print(currentTemp, 1);
    display.setTextSize(1);
    display.print(" /");
    display.print((int)setpointSuhi);
    display.print("C");
  }

  display.drawLine(0, 32, 127, 32, SH110X_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 35);
  display.print("DINAMO:");
  display.setCursor(52, 35);
  switch (dinamoState) {
    case DINAMO_OFF:    display.print("OFF");        break;
    case DINAMO_LEVEL1: display.print("PELAN  45%"); break;
    case DINAMO_LEVEL2: display.print("SEDANG 65%"); break;
    case DINAMO_LEVEL3: display.print("CEPAT 100%"); break;
  }

  display.setCursor(0, 46);
  display.print("HEATER:");
  display.setCursor(52, 46);
  if (heaterState == HEATER_ON) {
    int pct = map((int)pidOutput, 0, 255, 0, 100);
    display.printf("PID OUT: %d%%", pct);
  } else {
    display.print("OFF");
  }

  display.drawLine(0, 57, 127, 57, SH110X_WHITE);
  display.setCursor(0, 59);
  if (overheatShutdown)          display.print("!!! ALARM OVERHEAT !!!");
  else if (currentTemp >= SUHU_WARNING)  display.print("! SUHU TINGGI - WARNING");
  else                                   display.print("Cloud Status: Connected");

  display.display();
}

// ===== HANDLE HEATER PID =====
void handleHeaterPID() {
  if (overheatShutdown) {
    ledcWrite(DINAMO_PIN, 0); // Di versi baru, ledcWrite langsung menggunakan PIN, bukan channel
    return;
  }

  if (heaterState == HEATER_ON) {
    pidInput = currentTemp;
    myPID.Compute();
    ledcWrite(HEATER_PIN, (int)pidOutput);
  } else {
    ledcWrite(HEATER_PIN, 0);
  }
}

// ===== PARSE SUPABASE RESPONSE =====
// ===== PARSE SUPABASE RESPONSE =====
void parseSupabaseResponse(String response) {
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, response);

  if (error) {
    Serial.print("Parsing JSON gagal: ");
    Serial.println(error.c_str());
    return;
  }

  // PERBAIKAN: Karena Supabase mengembalikan format Array [], ambil indeks ke-0 terlebih dahulu
  JsonObject obj = doc[0].as<JsonObject>();

  // 1. Parsing Getaran / Dinamo dari objek indeks ke-0
  if (obj.containsKey("vibration_pwm")) {
    int remoteVib = obj["vibration_pwm"];
    
    if (remoteVib == 1) {
      dinamoState = DINAMO_LEVEL1;
      ledcWrite(DINAMO_PIN, 115); // Kecepatan Pelan 45%
    } else if (remoteVib == 2) {
      dinamoState = DINAMO_LEVEL2;
      ledcWrite(DINAMO_PIN, 166); // Kecepatan Sedang 65%
    } else if (remoteVib == 3) {
      dinamoState = DINAMO_LEVEL3;
      ledcWrite(DINAMO_PIN, 255); // Kecepatan Penuh 100%
    } else {
      dinamoState = DINAMO_OFF;
      ledcWrite(DINAMO_PIN, 0);   // Dinamo Mati
    }
  }

  // 2. Parsing Pemanas dari objek indeks ke-0
  if (obj.containsKey("heater_pwm")) {
    int remoteHeater = obj["heater_pwm"];
    
    if (remoteHeater > 0) {
      heaterState = HEATER_ON;
      setpointSuhi = 50.0; // Sesuaikan dengan kebutuhan target suhu Anda (misal 50.0)
      myPID.SetMode(AUTOMATIC);
    } else {
      heaterState = HEATER_OFF;
      myPID.SetMode(MANUAL);
      pidOutput = 0;
      ledcWrite(HEATER_PIN, 0); // Paksa heater mati total
    }
  }
}

// ===== SYNC SUPABASE =====
// ===== SYNC SUPABASE =====
void syncWithSupabase() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi Terputus, gagal sinkronisasi.");
    return;
  }

  HTTPClient http;
  String url = String(supabase_url) + "/rest/v1/device_status?id=eq." + String(DEVICE_ID);
  
  // 1. Mulai HTTP PATCH (Kirim data suhu terkini ke Supabase)
  http.begin(url);
  http.setTimeout(4000); // Batas toleransi respons jaringan agar tidak macet
  http.addHeader("apikey", anon_key);
  http.addHeader("Authorization", "Bearer " + String(anon_key));
  http.addHeader("Content-Type", "application/json");

  String jsonPayload = "{\"sensor_temp\":" + String(currentTemp, 1) + "}";
  int httpResponseCode = http.PATCH(jsonPayload);
  http.end(); // Akhiri sesi PATCH

  // 2. Mulai HTTP GET (Ambil data kontrol terbaru dari Supabase)
  http.begin(url);
  http.setTimeout(4000); 
  http.addHeader("apikey", anon_key);
  http.addHeader("Authorization", "Bearer " + String(anon_key));
  
  int getCode = http.GET();
  
  if (getCode > 0) {
    String response = http.getString();
    
    // Perbaikan Utama: Memanggil fungsi internal Anda untuk menggerakkan pin fisik & PID
    parseSupabaseResponse(response);
    
    // Pemrosesan dokumen untuk pencetakan Serial Monitor
    DynamicJsonDocument doc(1024);
    deserializeJson(doc, response);
    JsonObject obj = doc[0].as<JsonObject>(); 
    
    int heaterPwm = obj["heater_pwm"];
    int vibrationPwm = obj["vibration_pwm"];
    
    // ─── MONITORING SAKLAR VIA SERIAL MONITOR ───
    Serial.println("\n=== [ DATA REMOTE CONTROL SUPABASE ] ===");
    if (heaterPwm > 0) {
      Serial.print("  [✓] PEMANAS: ON  -> Nilai PWM: ");
      Serial.println(heaterPwm);
    } else {
      Serial.println("  [ ] PEMANAS: OFF -> Logika PID dimatikan");
    }

    if (vibrationPwm > 0) {
      Serial.print("  [✓] GETARAN: ON  -> Tingkat Volume: ");
      Serial.println(vibrationPwm);
    } else {
      Serial.println("  [ ] GETARAN: OFF");
    }
    Serial.println("=========================================\n");

  } else {
    Serial.print("Gagal sinkronisasi ke Supabase. Code: ");
    Serial.println(getCode);
  }
  
  http.end(); // Akhiri sesi GET
}

// ===== INITIALIZE SETUP =====
void setup() {
  Serial.begin(115200);
  Wire.begin(OLED_SDA, OLED_SCL);

  // Scan dan Init OLED Display
  oledAddress = scanI2C();
  if (display.begin(oledAddress, true)) {
    oledOK = true;
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(10, 25);
    display.print("BOOTING SYSTEM...");
    display.display();
  }

  // REVISI UNTUK ESP32 CORE v3.x: Menggunakan ledcAttach langsung ke PIN fisik
  ledcAttach(DINAMO_PIN, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(HEATER_PIN, PWM_FREQ, PWM_RESOLUTION);

  // Setup Pin Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Start Sensor DS18B20
  sensors.begin();

  // Setup PID
  myPID.SetOutputLimits(0, 255);
  myPID.SetMode(MANUAL);

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  // Perbaikan error wide character L
  Serial.println("\nConnected to WiFi!");

  if (oledOK) {
    display.clearDisplay();
    display.setCursor(10, 25);
    display.print("SYSTEM READY!");
    display.display();
    delay(1000);
  }
}

// ===== MAIN LOOP =====
void loop() {
  unsigned long currentMillis = millis();

  // 1. Baca Sensor Suhu DS18B20 (Setiap 2 Detik)
  if (currentMillis - lastTempRead >= 2000) {
    lastTempRead = currentMillis;
    sensors.requestTemperatures();
    float tempFetch = sensors.getTempCByIndex(0);
    
    if (tempFetch != DEVICE_DISCONNECTED_C) {
      currentTemp = tempFetch;
    }

    // Proteksi Overheat Hardware
    if (currentTemp >= SUHU_DANGER) {
      overheatShutdown = true;
      heaterState = HEATER_OFF;
      myPID.SetMode(MANUAL);
    } else if (currentTemp < SUHU_WARNING) {
      overheatShutdown = false; 
    }
  }

  // 2. Jalankan Perhitungan Kontrol PID Heater
  handleHeaterPID();

  // 3. Sinkronisasi Data Cloud Supabase (Sesuai Interval Tanpa Delay)
  if (currentMillis - lastSupabaseSync >= supabaseInterval) {
    lastSupabaseSync = currentMillis;
    
    // Memanggil fungsi sinkronisasi yang di dalamnya sudah mencetak status saklar
    syncWithSupabase();
  }

  // 4. Update Tampilan Layar OLED (Setiap 0.5 Detik)
  if (currentMillis - lastOledUpdate >= 500) {
    lastOledUpdate = currentMillis;
    updateOLED();
  }

  // 5. Logika Driver Sistem Alarm Buzzer
  if (overheatShutdown) {
    if (currentMillis - buzzerTimer >= BUZZER_BEEP_FAST) {
      buzzerTimer = currentMillis;
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }
  } else if (currentTemp >= SUHU_WARNING) {
    if (currentMillis - buzzerTimer >= BUZZER_BEEP_SLOW) {
      buzzerTimer = currentMillis;
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}