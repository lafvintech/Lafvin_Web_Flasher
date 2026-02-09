/*
  LAFVIN ESP Web Flasher - ESPTool 集成层
  负责串口通信、烧录、串口监视器功能
*/

import { ESPLoader, Transport } from './esptool-js/bundle.js';
import { Terminal } from 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm';
import { FitAddon } from 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm';

// --- 主控制台终端（显示连接状态、烧录进度等） ---
const terminalElement = document.getElementById('terminal-log');
const term = new Terminal({
    cols: 80, rows: 20, convertEol: true,
    theme: { background: '#000', foreground: '#0F0' }
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(terminalElement);
fitAddon.fit();

// --- 串口监视器终端 ---
const serialMonitorTerminal = new Terminal({
    convertEol: true,
    theme: { background: '#1E1E1E', foreground: '#FFFFFF' }
});
const monitorFitAddon = new FitAddon();
serialMonitorTerminal.loadAddon(monitorFitAddon);

// esptool-js 需要的终端适配器
const consoleTerminal = {
    clean: () => term.clear(),
    writeLine: (data) => term.writeln(data),
    write: (data) => term.write(data),
};

function clearSerialTerminal() {
    serialMonitorTerminal.clear();
}

// --- 全局状态 ---
let device = null;
let transport = null;
let esploader = null;
let monitorReader = null;
let keepReading = false;
let currentBaudRate = 115200;

// --- Hard Reset（进应用模式） ---
async function hardReset() {
    if (!device) return;
    await device.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    await device.setSignals({ dataTerminalReady: false, requestToSend: false });
    await new Promise(resolve => setTimeout(resolve, 200));
}

// --- 连接设备 ---
async function connectToDevice(baudrate) {
    try {
        if (device === null) {
            device = await navigator.serial.requestPort();
        }
        if (device.readable) {
            await device.close();
        }
        consoleTerminal.writeLine(`Connecting to serial port at ${baudrate}...`);
        await device.open({ baudRate: baudrate });
        await device.setSignals({ dataTerminalReady: false, requestToSend: false });
        currentBaudRate = baudrate;
        setTimeout(() => startSerialMonitor(), 100);
        return true;
    } catch (error) {
        consoleTerminal.writeLine(`Connection failed: ${error.message}`);
        throw error;
    }
}

// --- 断开连接 ---
async function disconnectDevice() {
    try {
        await stopSerialMonitor();
        if (device) {
            await device.close();
            device = null;
        }
        consoleTerminal.writeLine("Device disconnected.");
    } catch (error) {
        consoleTerminal.writeLine(`Disconnect failed: ${error.message}`);
    }
}

// --- 串口监视器 ---
async function startSerialMonitor() {
    if (keepReading) {
        keepReading = false;
        if (monitorReader) {
            try { await monitorReader.cancel(); } catch(e) {}
            monitorReader = null;
        }
    }
    if (!device || !device.readable) return;
    keepReading = true;
    readLoop();
}

async function readLoop() {
    while (device && device.readable && keepReading) {
        try {
            monitorReader = device.readable.getReader();
            while (true) {
                const { value, done } = await monitorReader.read();
                if (done) break;
                if (value) serialMonitorTerminal.write(value);
            }
        } catch (error) {
            break;
        } finally {
            if (monitorReader) {
                monitorReader.releaseLock();
                monitorReader = null;
            }
        }
    }
}

async function stopSerialMonitor() {
    keepReading = false;
    if (monitorReader) await monitorReader.cancel();
}

async function sendSerialData(data) {
    if (!device || !device.writable) return;
    const writer = device.writable.getWriter();
    try {
        await writer.write(new TextEncoder().encode(data));
    } finally {
        writer.releaseLock();
    }
}

async function changeBaudRate(newBaudRate) {
    if (!device) return;
    await stopSerialMonitor();
    await device.close();
    await device.open({ baudRate: newBaudRate });
    await device.setSignals({ dataTerminalReady: false, requestToSend: false });
    currentBaudRate = newBaudRate;
    startSerialMonitor();
}

// --- 固件烧录 ---
async function fetchBinaryFile(filePath) {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    return Array.from(new Uint8Array(buffer), byte => String.fromCharCode(byte)).join('');
}

async function startFlashing(selectedVersion, eraseFlash, flashBaudRate) {
    if (!device) throw new Error("Device not connected.");

    const monitorBaudRate = currentBaudRate;
    consoleTerminal.writeLine("Preparing for flashing...");
    await stopSerialMonitor();
    await device.close();

    try {
        consoleTerminal.writeLine(`Initializing loader at ${flashBaudRate} baud...`);
        transport = new Transport(device, true);

        esploader = new ESPLoader({
            transport,
            baudrate: flashBaudRate,
            terminal: consoleTerminal,
            debugLogging: false,
        });

        const chipName = await esploader.main();
        consoleTerminal.writeLine(`Detected chip: ${chipName}`);

        if (eraseFlash) {
            await esploader.eraseFlash();
        }

        // 下载固件
        consoleTerminal.writeLine("Downloading firmware files...");
        const manifestPath = selectedVersion.manifest_path;
        const basePath = manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1);
        const manifestResponse = await fetch(manifestPath);
        if (!manifestResponse.ok) throw new Error("Failed to fetch manifest.");
        const manifest = await manifestResponse.json();

        const fileArray = [];
        for (const build of manifest.builds) {
            for (const part of build.parts) {
                consoleTerminal.writeLine(`Fetching ${part.path}...`);
                const binaryData = await fetchBinaryFile(`${basePath}${part.path}`);
                fileArray.push({ data: binaryData, address: part.offset });
            }
        }

        // 写入 flash
        consoleTerminal.writeLine("Writing to flash...");
        let lastProgressLine = "";
        await esploader.writeFlash({
            fileArray,
            flashSize: "detect",
            eraseAll: false,
            compress: true,
            flashMode: "keep",
            flashFreq: "keep",
            reportProgress: (fileIndex, written, total) => {
                const percentage = ((written / total) * 100).toFixed(0);
                const filled = Math.round(20 * (written / total));
                const bar = '[' + '█'.repeat(filled) + '-'.repeat(20 - filled) + ']';
                const newLine = `File ${fileIndex + 1}/${fileArray.length} ${bar} ${percentage}% `;
                if (newLine !== lastProgressLine) {
                    consoleTerminal.write(newLine);
                    lastProgressLine = newLine;
                }
            },
            calculateMD5Hash: (image) => window.CryptoJS.MD5(window.CryptoJS.enc.Latin1.parse(image)).toString(),
        });

        consoleTerminal.writeLine("\n\rFlashing complete!");
    } catch (error) {
        consoleTerminal.writeLine(`\n\rFlashing failed: ${error.message}`);
        throw error;
    } finally {
        if (transport) {
            await transport.disconnect();
            transport = null;
            esploader = null;
        }
        try {
            consoleTerminal.writeLine("Restoring serial connection...");
            await device.open({ baudRate: monitorBaudRate });
            await hardReset();
            startSerialMonitor();
            consoleTerminal.writeLine("Device ready.");
        } catch (e) {
            consoleTerminal.writeLine("Note: Please manually reconnect if needed.");
        }
    }
}

function getConnectedPort() { return device; }

export {
    connectToDevice, disconnectDevice, startFlashing,
    getConnectedPort, consoleTerminal, fitAddon,
    changeBaudRate, serialMonitorTerminal, monitorFitAddon,
    startSerialMonitor, stopSerialMonitor,
    sendSerialData, clearSerialTerminal
};
