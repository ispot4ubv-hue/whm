const os = require('os');
const http = require('http');
const { Buffer } = require('buffer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');

const UUID = process.env.UUID || 'b28f60af-d0b9-4ddf-baaa-7e49c93c380b';
const uuid = UUID.replace(/-/g, '');

const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';

const DOMAIN = process.env.DOMAIN || '';
const NAME = process.env.NAME || 'WHM';

const port = Number(process.env.PORT) || 3000;


// ============================================================
// HTTP SERVER
// ============================================================

const httpServer = http.createServer((req, res) => {

    if (req.url === '/') {
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('WHM Server is running\n');
        return;
    }


    if (req.url === '/sub') {

        const vlessURL =
            `vless://${UUID}@skk.moe:443` +
            `?encryption=none` +
            `&security=tls` +
            `&sni=${DOMAIN}` +
            `&type=ws` +
            `&host=${DOMAIN}` +
            `&path=%2F` +
            `#${NAME}`;

        const base64Content =
            Buffer.from(vlessURL).toString('base64');

        res.writeHead(200, {
            'Content-Type': 'text/plain'
        });

        res.end(base64Content + '\n');
        return;
    }


    res.writeHead(404, {
        'Content-Type': 'text/plain'
    });

    res.end('Not Found\n');
});


httpServer.listen(port, '0.0.0.0', () => {
    console.log(`HTTP Server is running on port ${port}`);
});


// ============================================================
// NEZHA
// ============================================================

function getSystemArchitecture() {

    const arch = os.arch();

    if (arch === 'arm' || arch === 'arm64') {
        return 'arm';
    }

    return 'amd';
}


function getFilesForArchitecture(architecture) {

    if (architecture === 'arm') {
        return [
            {
                fileName: 'npm',
                fileUrl:
                    'https://github.com/eooce/test/releases/download/ARM/swith'
            }
        ];
    }

    if (architecture === 'amd') {
        return [
            {
                fileName: 'npm',
                fileUrl:
                    'https://github.com/eooce/test/releases/download/bulid/swith'
            }
        ];
    }

    return [];
}


function downloadFile(fileName, fileUrl) {

    return new Promise(async (resolve, reject) => {

        const filePath = path.join(__dirname, fileName);

        try {

            console.log(`Downloading ${fileName}...`);

            const response = await axios({
                method: 'GET',
                url: fileUrl,
                responseType: 'stream',
                timeout: 60000,
                maxRedirects: 5,
                validateStatus: status =>
                    status >= 200 && status < 300
            });


            const writer = fs.createWriteStream(filePath);

            response.data.pipe(writer);


            writer.on('finish', () => {

                writer.close();

                console.log(
                    `Download ${fileName} successfully`
                );

                resolve(filePath);
            });


            writer.on('error', error => {

                try {
                    writer.close();
                } catch (_) {}

                reject(error);
            });


        } catch (error) {

            reject(error);
        }

    });
}


async function startNezha() {

    // --------------------------------------------------------
    // اگر اطلاعات Nezha وجود ندارد، اصلاً دانلود نکن
    // --------------------------------------------------------

    if (!NEZHA_SERVER || !NEZHA_PORT || !NEZHA_KEY) {

        console.log(
            'NEZHA variables are empty, skipping Nezha Agent'
        );

        return;
    }


    try {

        const architecture =
            getSystemArchitecture();

        const filesToDownload =
            getFilesForArchitecture(architecture);


        if (!filesToDownload.length) {

            console.log(
                `Unsupported architecture: ${architecture}`
            );

            return;
        }


        for (const fileInfo of filesToDownload) {

            try {

                await downloadFile(
                    fileInfo.fileName,
                    fileInfo.fileUrl
                );

            } catch (error) {

                console.error(
                    `Download ${fileInfo.fileName} failed:`,
                    error.message
                );

                console.error(
                    'Nezha Agent will be skipped.'
                );

                return;
            }
        }


        const filePath =
            path.join(__dirname, 'npm');


        try {

            fs.chmodSync(filePath, 0o775);

            console.log(
                'Nezha Agent permission set successfully'
            );

        } catch (error) {

            console.error(
                'Failed to chmod Nezha Agent:',
                error.message
            );

            return;
        }


        let tls = '';

        if (NEZHA_PORT === '443') {
            tls = '--tls';
        }


        const command =
            `"${filePath}" -s ${NEZHA_SERVER}:${NEZHA_PORT}` +
            ` -p ${NEZHA_KEY}` +
            ` ${tls}` +
            ` --skip-conn` +
            ` --disable-auto-update` +
            ` --skip-procs` +
            ` --report-delay 4`;


        console.log('Starting Nezha Agent...');


        const child =
            exec(command);


        child.stdout.on('data', data => {
            console.log(`Nezha: ${data.trim()}`);
        });


        child.stderr.on('data', data => {
            console.error(`Nezha: ${data.trim()}`);
        });


        child.on('error', error => {
            console.error(
                'Nezha process error:',
                error.message
            );
        });


        child.on('exit', (code, signal) => {

            console.log(
                `Nezha Agent exited. code=${code}, signal=${signal}`
            );

        });


    } catch (error) {

        console.error(
            'Nezha startup failed:',
            error.message
        );

    }
}


// شروع Nezha بدون متوقف کردن HTTP Server
startNezha();


// ============================================================
// WEBSOCKET / VLESS
// ============================================================

const wss =
    new WebSocket.Server({
        server: httpServer
    });


wss.on('connection', ws => {

    console.log('WebSocket connection established');


    ws.on('message', msg => {

        if (msg.length < 18) {

            console.error(
                'Invalid data length'
            );

            return;
        }


        try {

            const [VERSION] = msg;

            const id =
                msg.slice(1, 17);


            if (
                !id.every(
                    (v, i) =>
                        v ===
                        parseInt(
                            uuid.substr(i * 2, 2),
                            16
                        )
                )
            ) {

                console.error(
                    'UUID validation failed'
                );

                return;
            }


            let i =
                msg.slice(17, 18).readUInt8() + 19;


            const targetPort =
                msg
                    .slice(i, i += 2)
                    .readUInt16BE(0);


            const ATYP =
                msg
                    .slice(i, i += 1)
                    .readUInt8();


            let host;


            if (ATYP === 1) {

                host =
                    msg
                        .slice(i, i += 4)
                        .join('.');

            } else if (ATYP === 2) {

                const length =
                    msg
                        .slice(i, i + 1)
                        .readUInt8();


                host =
                    new TextDecoder().decode(
                        msg.slice(
                            i + 1,
                            i += 1 + length
                        )
                    );

            } else if (ATYP === 3) {

                host =
                    msg
                        .slice(i, i += 16)
                        .reduce(
                            (s, b, index, array) =>
                                index % 2
                                    ? s.concat(
                                        array.slice(
                                            index - 1,
                                            index + 1
                                        )
                                    )
                                    : s,
                            []
                        )
                        .map(
                            b =>
                                b
                                    .readUInt16BE(0)
                                    .toString(16)
                        )
                        .join(':');

            } else {

                console.error(
                    'Unknown ATYP'
                );

                return;
            }


            console.log(
                `Connecting to: ${host}:${targetPort}`
            );


            ws.send(
                new Uint8Array([
                    VERSION,
                    0
                ])
            );


            const duplex =
                createWebSocketStream(ws);


            const socket =
                net.connect(
                    {
                        host,
                        port: targetPort
                    },
                    function () {

                        this.write(
                            msg.slice(i)
                        );

                        duplex
                            .on(
                                'error',
                                err =>
                                    console.error(
                                        'WebSocket stream error:',
                                        err.message
                                    )
                            )
                            .pipe(this)
                            .on(
                                'error',
                                err =>
                                    console.error(
                                        'TCP error:',
                                        err.message
                                    )
                            )
                            .pipe(duplex);
                    }
                );


            socket.on(
                'error',
                err =>
                    console.error(
                        'Connection error:',
                        err.message
                    )
            );

        } catch (err) {

            console.error(
                'Message processing error:',
                err.message
            );

        }

    });


    ws.on('error', err => {

        console.error(
            'WebSocket error:',
            err.message
        );

    });

});
