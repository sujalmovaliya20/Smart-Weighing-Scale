#include <HX711.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Preferences.h>
#include <RTClib.h>
#include <NimBLEDevice.h>
#include <FS.h>
#include <LittleFS.h>

#define DOUT_PIN 4
#define SCK_PIN  5

HX711 scale;
LiquidCrystal_I2C lcd(0x27, 16, 2);
 
Preferences prefs;
RTC_DS3231 rtc;

#define BLE_DEVICE_NAME "SAHIL_SCALE"

#define SERVICE_UUID        "12345678-1234-1234-1234-123456789001"
#define CHARACTERISTIC_UUID "12345678-1234-1234-1234-123456789002"

NimBLECharacteristic* pCharacteristic = nullptr;

bool deviceConnected = false;
volatile bool isAuthenticated = false;

enum CommandType {
  CMD_NONE,
  CMD_SET_CUSTOMER,
  CMD_NEXT_CUSTOMER,
  CMD_GET_CUSTOMER,
  CMD_GET_ALL,
  CMD_RESET_ALL
};

volatile CommandType cmdType = CMD_NONE;
volatile bool newCmdReceived = false;
String nextCustomerName = "";
String queryCustomerName = "";

String currentCustomer = "";
uint32_t currentItemCounter = 0;
String lastRecordedDate = "";

long zeroRaw = 0;
long oneKgRaw = 0;
float calibrationFactor = 0;

struct WeightRecord
{
  String customer;
  uint32_t item;
  float weight;
  char time[9];
  char date[11];
};

// ---------- Stable Detection ----------//
const float EMPTY_THRESHOLD = 0.10;   // kg
const float STABLE_DELTA    = 0.02;   // kg
const uint32_t STABLE_TIME  = 3000;   // ms

bool weightLogged = false;
bool stableTimerRunning = false;

float lastWeight = 0;
unsigned long stableStartTime = 0;

// --------------------------------------

long getAverageRaw()
{
  long sum = 0;

  for (int i = 0; i < 10; i++)
  {
    sum += scale.read();
  }

  return sum / 10;
}

void saveConfig()
{
  prefs.putLong("zero", zeroRaw);
  prefs.putFloat("factor", calibrationFactor);
}

void resetConfig()
{
  zeroRaw = 0;
  oneKgRaw = 0;
  calibrationFactor = 0;
  currentCustomer = "";
  currentItemCounter = 0;

  prefs.clear();
  saveConfig();
}

void loadConfig()
{
  zeroRaw = prefs.getLong("zero", 0);
  calibrationFactor = prefs.getFloat("factor", 0);
}

void printDateTime()
{
  DateTime now = rtc.now();

  Serial.print(now.day());
  Serial.print("/");

  Serial.print(now.month());
  Serial.print("/");

  Serial.print(now.year());

  Serial.print(" ");

  if (now.hour() < 10) Serial.print("0");
  Serial.print(now.hour());
  Serial.print(":");

  if (now.minute() < 10) Serial.print("0");
  Serial.print(now.minute());
  Serial.print(":");

  if (now.second() < 10) Serial.print("0");
  Serial.println(now.second());
}

void printSavedRecord(float weight)
{
  DateTime now = rtc.now();

  Serial.println();
  Serial.println("=================================");
  Serial.println("ENTRY SAVED");

  Serial.print("Customer: ");
  Serial.println(currentCustomer.length() > 0 ? currentCustomer : "Unknown");

  Serial.print("Item    : ");
  Serial.println(currentItemCounter);

  Serial.print("Weight: ");
  Serial.print(weight, 3);
  Serial.println(" kg");

  Serial.print("Date  : ");

  if (now.day() < 10) Serial.print("0");
  Serial.print(now.day());
  Serial.print("/");

  if (now.month() < 10) Serial.print("0");
  Serial.print(now.month());
  Serial.print("/");

  Serial.println(now.year());

  Serial.print("Time  : ");

  if (now.hour() < 10) Serial.print("0");
  Serial.print(now.hour());
  Serial.print(":");

  if (now.minute() < 10) Serial.print("0");
  Serial.print(now.minute());
  Serial.print(":");

  if (now.second() < 10) Serial.print("0");
  Serial.print(now.second());

  Serial.println();
  Serial.println("=================================");
}

void showWeight(float weight, const char* status)
{
  char line1[17];
  char line2[17];

  snprintf(line1, sizeof(line1), "Wt:%6.3fkg", weight);
  snprintf(line2, sizeof(line2), "%s", status);

  // Pad both lines to the display width to avoid leftover characters.
  for (int i = strlen(line1); i < 16; i++) line1[i] = ' ';
  line1[16] = '\0';
  for (int i = strlen(line2); i < 16; i++) line2[i] = ' ';
  line2[16] = '\0';

  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

class ServerCallbacks : public NimBLEServerCallbacks
{
public:
  void onConnect(NimBLEServer* pServer,
                 NimBLEConnInfo& connInfo)
  {
    deviceConnected = true;
    Serial.println("BLE Client Connected");
  }

  void onDisconnect(NimBLEServer* pServer,
                    NimBLEConnInfo& connInfo,
                    int reason)
  {
    deviceConnected = false;
    isAuthenticated = false;

    Serial.println("BLE Client Disconnected");

    NimBLEDevice::startAdvertising();
  }
};

class CharacteristicCallbacks : public NimBLECharacteristicCallbacks
{
public:
  void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override
  {
    std::string value = pChar->getValue();
    Serial.print("BLE Write received: ");
    Serial.println(value.c_str());
    
    if (value.rfind("AUTH:", 0) == 0)
    {
      String pass = String(value.substr(5).c_str());
      if (pass == "sahil1186")
      {
        isAuthenticated = true;
        pChar->setValue("AUTH_SUCCESS");
        pChar->notify();
        Serial.println("Authentication successful!");
      }
      else
      {
        isAuthenticated = false;
        pChar->setValue("AUTH_FAIL");
        pChar->notify();
        Serial.println("Authentication failed!");
      }
      return;
    }

    if (!isAuthenticated)
    {
      Serial.println("Command rejected: Client not authenticated");
      pChar->setValue("AUTH_REQUIRED");
      pChar->notify();
      return;
    }
    
    if (value.rfind("SET_CUSTOMER:", 0) == 0)
    {
      nextCustomerName = String(value.substr(13).c_str());
      cmdType = CMD_SET_CUSTOMER;
      newCmdReceived = true;
    }
    else if (value == "NEXT_CUSTOMER")
    {
      cmdType = CMD_NEXT_CUSTOMER;
      newCmdReceived = true;
    }
    else if (value.rfind("GET_CUSTOMER:", 0) == 0)
    {
      queryCustomerName = String(value.substr(13).c_str());
      cmdType = CMD_GET_CUSTOMER;
      newCmdReceived = true;
    }
    else if (value == "GET_ALL_RECORDS")
    {
      cmdType = CMD_GET_ALL;
      newCmdReceived = true;
    }
    else if (value == "RESET_ALL" || value == "DELETE_TODAY")
    {
      cmdType = CMD_RESET_ALL;
      newCmdReceived = true;
    }
  }
};

void setupBLE()
{
  NimBLEDevice::init(BLE_DEVICE_NAME);

  NimBLEServer* pServer =
      NimBLEDevice::createServer();

  pServer->setCallbacks(
      new ServerCallbacks());

  NimBLEService* pService =
      pServer->createService(
          SERVICE_UUID);

  pCharacteristic =
      pService->createCharacteristic(
          CHARACTERISTIC_UUID,
          NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::READ);

  pCharacteristic->setCallbacks(new CharacteristicCallbacks());

  pService->start();

  NimBLEAdvertising* pAdvertising =
      NimBLEDevice::getAdvertising();

  pAdvertising->addServiceUUID(
      SERVICE_UUID);

  pAdvertising->start();

  Serial.println("BLE Ready");
}

void fillWeightRecord(WeightRecord& record, float weight)
{
  DateTime now = rtc.now();

  record.customer = currentCustomer.length() > 0 ? currentCustomer : "Unknown";
  record.item = record.customer == "Unknown" ? 0 : currentItemCounter;
  record.weight = weight;

  snprintf(
      record.time,
      sizeof(record.time),
      "%02d:%02d:%02d",
      now.hour(),
      now.minute(),
      now.second());

  snprintf(
      record.date,
      sizeof(record.date),
      "%02d/%02d/%04d",
      now.day(),
      now.month(),
      now.year());
}

String createJsonRecord(const WeightRecord& record)
{
  String json;
  json.reserve(160);

  json += "{";
  json += "\"customer\":\"";
  json += record.customer;
  json += "\",\"item\":";
  json += String(record.item);
  json += ",\"weight\":";
  json += String(record.weight, 3);
  json += ",\"time\":\"";
  json += String(record.time);
  json += "\",\"date\":\"";
  json += String(record.date);
  json += "\"";
  json += "}";

  return json;
}

void setupFS()
{
  if (!LittleFS.begin(true))
  {
    Serial.println("LittleFS Mount Failed");
    lcd.clear();
    lcd.print("FS Mount Error");
    delay(2000);
  }
  else
  {
    Serial.println("LittleFS Mounted successfully");
  }
}

void saveRecordToFlash(const String& jsonRecord)
{
  File file = LittleFS.open("/records.jsonl", FILE_APPEND);
  if (!file)
  {
    Serial.println("Failed to open file for appending");
    return;
  }
  if (file.println(jsonRecord))
  {
    Serial.println("Record saved to Flash");
  }
  else
  {
    Serial.println("Write failed");
  }
  file.close();
}

uint32_t countCustomerItems(const String& customerName)
{
  if (customerName.length() == 0)
    return 0;

  File file = LittleFS.open("/records.jsonl", FILE_READ);
  if (!file)
    return 0;

  uint32_t count = 0;
  String targetPattern = "\"customer\":\"" + customerName + "\"";
  while (file.available())
  {
    String line = file.readStringUntil('\n');
    if (line.indexOf(targetPattern) != -1)
    {
      count++;
    }
  }
  file.close();
  return count;
}

void sendCustomerRecordsBLE(const String& customerName)
{
  if (!deviceConnected || !isAuthenticated)
    return;

  File file = LittleFS.open("/records.jsonl", FILE_READ);
  if (!file)
  {
    pCharacteristic->setValue("SYNC_COMPLETE");
    pCharacteristic->notify();
    return;
  }

  String targetPattern = "\"customer\":\"" + customerName + "\"";
  while (file.available())
  {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() > 0 && line.indexOf(targetPattern) != -1)
    {
      pCharacteristic->setValue(line.c_str());
      pCharacteristic->notify();
      delay(50);
    }
  }
  file.close();

  pCharacteristic->setValue("SYNC_COMPLETE");
  pCharacteristic->notify();
}

void sendAllRecordsBLE()
{
  if (!deviceConnected || !isAuthenticated)
    return;

  File file = LittleFS.open("/records.jsonl", FILE_READ);
  if (!file)
  {
    pCharacteristic->setValue("SYNC_COMPLETE");
    pCharacteristic->notify();
    return;
  }

  while (file.available())
  {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() > 0)
    {
      pCharacteristic->setValue(line.c_str());
      pCharacteristic->notify();
      delay(50);
    }
  }
  file.close();

  pCharacteristic->setValue("SYNC_COMPLETE");
  pCharacteristic->notify();
}

void clearRecordsFlash()
{
  if (LittleFS.exists("/records.jsonl"))
  {
    LittleFS.remove("/records.jsonl");
  }
  currentItemCounter = 0;
  Serial.println("Flash records cleared");
}

void printAllRecordsSerial()
{
  File file = LittleFS.open("/records.jsonl", FILE_READ);
  if (!file)
  {
    Serial.println("No records found in Flash.");
    return;
  }

  Serial.println();
  Serial.println("=== Stored Records in Flash ===");
  int count = 0;
  while (file.available())
  {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() > 0)
    {
      Serial.println(line);
      count++;
    }
  }
  file.close();
  Serial.print("Total records: ");
  Serial.println(count);
  Serial.println("===============================");
}

String getTodayDateString()
{
  DateTime now = rtc.now();
  char buf[12];
  snprintf(buf, sizeof(buf), "%02d/%02d/%04d", now.day(), now.month(), now.year());
  return String(buf);
}

void setup()
{
  Serial.begin(115200);

  setupFS();

  scale.begin(DOUT_PIN, SCK_PIN);

  Wire.begin(21, 22);

  lcd.init();
  lcd.backlight();

  prefs.begin("scalecfg", false);

  loadConfig();

  if (!rtc.begin())
  {
    lcd.clear();
    lcd.print("RTC Error"); 

    while (1);
  }

  setupBLE();

  // Check date on boot
  String todayDate = getTodayDateString();
  lastRecordedDate = prefs.getString("last_date", "");
  if (lastRecordedDate != todayDate)
  {
    Serial.println("New day detected on boot. Erasing history...");
    clearRecordsFlash();
    prefs.putString("last_date", todayDate);
    lastRecordedDate = todayDate;
  }

  lcd.clear();
  lcd.print("Scale Ready");

  Serial.println("Commands:");
  Serial.println("0 = Reset Calibration");
  Serial.println("1 = Save Zero");
  Serial.println("2 = Save 1kg");
  Serial.println("3 = Print All Records from Flash");
  Serial.println("4 = Clear All Records from Flash");
  Serial.println("5 = Simulate Set Customer 'John'");
  Serial.println("6 = Simulate Next Customer");

  delay(1500);

  showWeight(0, "Ready");
}

void loop()
{
  // Handle asynchronous BLE commands safely in the main thread
  if (newCmdReceived)
  {
    newCmdReceived = false;
    CommandType activeCmd = cmdType;
    cmdType = CMD_NONE;

    if (activeCmd == CMD_SET_CUSTOMER)
    {
      currentCustomer = nextCustomerName;
      currentItemCounter = countCustomerItems(currentCustomer);
      Serial.print("Customer set to: ");
      Serial.println(currentCustomer);
      Serial.print("Restored item counter: ");
      Serial.println(currentItemCounter);
    }
    else if (activeCmd == CMD_NEXT_CUSTOMER)
    {
      Serial.println("Next Customer command received");
      currentCustomer = "";
      currentItemCounter = 0;
    }
    else if (activeCmd == CMD_GET_CUSTOMER)
    {
      Serial.print("Getting records for customer: ");
      Serial.println(queryCustomerName);
      sendCustomerRecordsBLE(queryCustomerName);
    }
    else if (activeCmd == CMD_GET_ALL)
    {
      Serial.println("Getting all records");
      sendAllRecordsBLE();
    }
    else if (activeCmd == CMD_RESET_ALL)
    {
      Serial.println("Resetting today's customer records");
      clearRecordsFlash();
    }
  }

  // Periodic RTC Date Check (once every 10 seconds)
  static unsigned long lastDateCheck = 0;
  if (millis() - lastDateCheck >= 10000)
  {
    lastDateCheck = millis();
    String todayDate = getTodayDateString();
    if (lastRecordedDate != todayDate)
    {
      Serial.println("New day detected! Clearing history file...");
      clearRecordsFlash();
      prefs.putString("last_date", todayDate);
      lastRecordedDate = todayDate;
    }
  }

  // ---------------- Calibration ----------------

  if (Serial.available())
  {
    char cmd = Serial.read();

    if (cmd == '0')
    {
      resetConfig();

      Serial.println("Calibration Reset");

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Reset Done");

      delay(1500);
    }
    else if (cmd == '1')
    {
      zeroRaw = getAverageRaw();

      saveConfig();

      Serial.print("Zero Saved = ");
      Serial.println(zeroRaw);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Zero Saved");

      delay(1500);
    }
    else if (cmd == '2')
    {
      oneKgRaw = getAverageRaw();

      calibrationFactor =
        (float)(oneKgRaw - zeroRaw);

      saveConfig();

      Serial.print("Factor = ");
      Serial.println(calibrationFactor);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Calibrated");

      delay(1500);
    }
    else if (cmd == '3')
    {
      printAllRecordsSerial();
    }
    else if (cmd == '4')
    {
      clearRecordsFlash();
    }
    else if (cmd == '5')
    {
      currentCustomer = "John";
      currentItemCounter = countCustomerItems(currentCustomer);
      Serial.print("Simulated set customer to John. Counter: ");
      Serial.println(currentItemCounter);
    }
    else if (cmd == '6')
    {
      currentCustomer = "";
      currentItemCounter = 0;
      Serial.println("Simulated next customer.");
    }
  }

  // ---------------- Weight Display ----------------

  if (calibrationFactor <= 0)
    return;

  long raw = getAverageRaw();

  float weight =
    (raw - zeroRaw) /
    calibrationFactor;

  if (weight < 0)
    weight = 0;

  // ---------- Re-arm after weight removal ----------

  if (weightLogged)
  {
    showWeight(weight, "Remove Wt");

    if (weight < EMPTY_THRESHOLD)
    {
      weightLogged = false;
      stableTimerRunning = false;

      showWeight(0, "Ready");

      Serial.println("Scale Rearmed");
    }

    delay(200);
    return;
  }

  // ---------- Ready State ----------

  if (weight < EMPTY_THRESHOLD)
  {
    stableTimerRunning = false;

    showWeight(weight, "Ready");

    delay(200);
    return;
  }

  // ---------- Measuring ----------

  showWeight(weight, "Measuring");

  if (!stableTimerRunning)
  {
    lastWeight = weight;
    stableStartTime = millis();
    stableTimerRunning = true;
  }

  // ---------- Stability Check ----------

  if (abs(weight - lastWeight) <= STABLE_DELTA)
  {
    showWeight(weight, "Stable...");

    if (millis() - stableStartTime >= STABLE_TIME)
    {
      currentItemCounter++;

      weightLogged = true;

      printSavedRecord(weight);

      WeightRecord record;
      fillWeightRecord(record, weight);

      String json = createJsonRecord(record);
      Serial.println(json);

      // Save record to Flash
      saveRecordToFlash(json);

      if (deviceConnected && isAuthenticated)
      {
        pCharacteristic->setValue(
          json.c_str());

        pCharacteristic->notify();
        Serial.println("BLE Notify Sent");
      }

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Wt:");
      lcd.print(weight, 3);
      lcd.print("kg");

      lcd.setCursor(0, 1);
      lcd.print(record.customer.substring(0, 8));
      lcd.print(" #");
      lcd.print(record.item);

      delay(2000);
    }
  }
  else
  {
    lastWeight = weight;
    stableStartTime = millis();
  }

  delay(200);
}