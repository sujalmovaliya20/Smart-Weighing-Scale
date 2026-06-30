# Scale (ESP32)

This repository contains an Arduino/ESP32 sketch for a digital scale device using an HX711 load cell amplifier, an I2C LCD, RTC, LittleFS storage, and BLE for data export and control.

Features
- Reads weight from an HX711 load cell
- Shows weight on an I2C LCD (16x2)
- Persists records to LittleFS (`/records.jsonl`)
- Uses RTC (DS3231) for timestamps
- Exposes BLE service/characteristic for authentication and record export

Hardware
- MCU: ESP32 (DevKit-style board)
- Load cell amplifier: HX711
- RTC: DS3231 (I2C)
- LCD: 16x2 I2C (0x27 typical)

Wiring / Pin map

Typical wiring used by the sketch (adjust if you changed pins in `v3-1.ino`):

- HX711
	- DOUT: GPIO4
	- SCK:  GPIO5

- I2C (Wire.begin(21, 22))
	- SDA: GPIO21
	- SCL: GPIO22

- LCD (I2C 0x27)
	- SDA: GPIO21
	- SCL: GPIO22

- RTC (I2C, shares bus with LCD)

Note: Verify pin labels for your exact ESP32 board revision.

Software prerequisites
- Arduino IDE (recommended by this README)
- Install these libraries from the Arduino Library Manager or GitHub:
	- HX711 (e.g., Bogde/HX711)
	- LiquidCrystal_I2C
	- RTClib (Adafruit)
	- NimBLE-Arduino (for BLE on ESP32)
	- Preferences (ESP32 core provides this)
	- LittleFS (ESP32 LittleFS or built-in support depending on core)

Build & Upload (Arduino IDE)
1. Open Arduino IDE and install the latest ESP32 board support via Boards Manager.
2. Select the correct ESP32 board (e.g., "ESP32 Dev Module") and the correct COM port.
3. Open the sketch file `v3-1.ino` in the IDE.
4. Ensure required libraries are installed (see the Software prerequisites section).
5. Click Upload.

Usage

- Power the ESP32 and the connected peripherals.
- The LCD will show initialization messages and then live weight readings.
- To calibrate: follow the on-screen/in-code calibration routine. The sketch stores calibration values persistently.

BLE authentication

The sketch currently uses a hardcoded password for BLE control and export. The default password in the sketch is:

```
//sahil1186//
```

This is not secure for production — consider changing the code to store a password in NVS (`Preferences`) or add a pairing flow. Future improvements planned include moving the password into `Preferences` and adding serial/BLE commands to change it.

Records & storage

- Measurement records are appended to `/records.jsonl` on the LittleFS filesystem.
- The sketch provides functions to export records over BLE and to print them over Serial.
- LittleFS space is finite; back up and clear records regularly if you produce many entries.

Exporting and backing up records

- Over Serial: connect the ESP32 USB serial and open the Arduino Serial Monitor (115200 baud). Use the provided serial command(s) in the sketch to stream all stored records.
- Over BLE: the sketch exposes a characteristic used to request and stream records (see `sendAllRecordsBLE()` and `sendCustomerRecordsBLE()` in the sketch).

Troubleshooting
- LCD shows garbage: verify I2C address and wiring.
- HX711 reads noisy values: ensure stable mechanical mounting and allow time for the reading to settle; check wiring and power.
- Filesystem write failures: confirm LittleFS is mounted successfully at startup; consider adding storage trimming if running out of space.
- BLE not advertising/connecting: confirm NimBLE library is installed and that BLE is enabled on your device.


Next steps (recommended)
1. Move the hardcoded BLE password into `Preferences` and add a serial/BLE flow to set/change it.
2. Harden LittleFS writes (atomic write + checks) and add a serial export/clear command.
3. Add calibration UI/serial commands and persist calibration values.

If you want, I can implement step 1 now and update the sketch to persist the BLE password and add a serial command to change it.
