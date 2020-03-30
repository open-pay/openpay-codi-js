(function () {
    'use strict';
    var root = typeof self == 'object' && self.self === self && self ||
        typeof global == 'object' && global.global === global && global ||
        this ||
        {};

    var CodiClient = function (obj) {
        if (obj instanceof CodiClient)
            return obj;
        if (!(this instanceof CodiClient))
            return new CodiClient(obj);
        this._wrapped = CodiClient;
    };

    root.CodiClient = CodiClient;

    // Constants
    CodiClient.PRODUCTION = "PRODUCTION";
    CodiClient.SANDBOX = "SANDBOX";
    CodiClient.DEVELOPMENT = "DEVELOPMENT";
    CodiClient.QA = "QA";
    CodiClient.LOCAL = "LOCAL";

    class RequestError extends Error {
        constructor(message) {
            super(message);
            this.name = "RequestError";
        }
    }

    let _selector = null;
    let _completeCallback = null;
    let _errorCallback = null;
    let _json = {};
    let _statusInterval = null;
    let _env = null;
    let _url = null;

    var _messages = new Map([
        ["COMPLETED", {text1:"Tu pago ha sido <strong>exitoso</strong>", text2: "¡Gracias por tu compra!"} ],
        ["CANCELLED", {text1:"Tu pago ha sido <strong>cancelado</strong>", text2: "Tu pago ha sido declinado o el cargo ha sido cancelado"}],
        ["EXPIRED", {text1:"Fecha de expiración: <strong>#EXPIRATION#</strong>", text2: "El cobro ha expirado"}],
        ["ERROR", {text1:"Error número: <strong>#ERROR#</strong>", text2: "Hubo un error al procesar la petición"}],
        ["FAILED", {text1:"Error número: <strong>#ERROR#</strong>", text2: "Hubo un error al procesar la petición"}]]);

    CodiClient.init = function (selector, options) {
        const PROD_URL = 'https://api.openpay.mx/v1/codi/transaction/';
        const SAND_URL = 'https://sandbox-api.openpay.mx/v1/codi/transaction/';
        const DEV_URL = 'https://dev-api.openpay.mx/v1/codi/transaction/';
        const QA_URL = 'https://qa-api.openpay.mx/v1/codi/transaction/';
        const LOCAL_URL = 'https://localhost:8443/Services/v1/codi/transaction/';

        if (selector === null) {
            throw new RequestError("No selector specified!");
        }
        _selector = document.getElementById(selector);
        if (_selector == null || _selector.tagName !== "DIV") {
            _selector = document.querySelector(selector);
            if (!_selector) {
                throw new RequestError("Element not found: " + selector);
            }
        }

        if (options && options.errorCallback && typeof options.errorCallback === 'function') {
            _errorCallback = options.errorCallback;
        }
        if (options && options.completeCallback && typeof options.completeCallback === 'function') {
            _completeCallback = options.completeCallback;
        }

        if (options && options.environment) {
            _env = options.environment;
        }

        if (_env) {
            switch (_env) {
                default:
                case CodiClient.PRODUCTION:
                    _url = PROD_URL;
                    break;
                case CodiClient.SANDBOX:
                    _url = SAND_URL;
                    break;
                case CodiClient.DEVELOPMENT:
                    _url = DEV_URL;
                    break;
                case CodiClient.QA:
                    _url = QA_URL;
                    break;
                case CodiClient.LOCAL:
                    _url = LOCAL_URL; 
                    break;
            }
        } else {
            _url = PROD_URL;
        }

        return CodiClient;
    }

    CodiClient.getTransactionStatus = function (trxId) {
        if (!trxId) {
            if (_errorCallback) {
                _errorCallback(new Error("Transaction ID is mandatory!"));
            } else {
                throw new RequestError("Transaction ID is mandatory!");
            }
        }
        requestStatus(trxId)
            .then(j => {
                displayStatus();
                if (_json.status === "CHARGE_PENDING") {
                    _statusInterval = setInterval(function () {
                        fetch(_url + trxId)
                            .then((resp) => resp.json())
                            .then(function (data) {
                                _json.status = data.status;//'CHARGE_PENDING';//
                                if (_json.status === "CHARGE_PENDING") {
                                    return _json.status;
                                } else {
                                    clearInterval(_statusInterval);
                                    displayStatus();
                                }
                            })
                            .catch(e => handleError(e));
                    }, 5000);
                } 
                    if (_completeCallback) {
                        _completeCallback(_json);
                    }
                
            })
            .catch(e => {
                handleError(e);
            });

        return CodiClient;
    };

    function handleError(e) {
        if (_errorCallback) {
            _errorCallback(e);
        }
        throw e;
    }

    function displayStatus() {
        _selector.innerHTML = displayStructure();
        let d2 = null;
        let header = document.getElementById("codiHeader");
        let section1 = document.getElementById("section1");
        let divAmount = document.getElementById("trxAmount");
        let divText = document.getElementById("trxText");
        
        divAmount.innerHTML = displayAmount(_json.amount);
        switch (_json.status) {
            case 'CHARGE_PENDING':
                if (_json.qrcode_base64) {
                    header.innerHTML = displayChargePendingHeader();
                    section1.innerHTML = displayImage(_json.qrcode_base64, _json.qrcode_url);
                } else if (_json.push_phone) {
                    header.innerHTML = displayChargePendingHeader(true);
                    section1.innerHTML = WAITING_FOR_PUSH_NOTIFICATION;
                } else {
                    throw new RequestError("No QR code or push notification phone number found!");
                }

                let d1 = new Date();
                if (_json.due_date) {
                    d2 = new Date(_json.due_date);
                    divText.innerHTML = displayTimeLeft(d1, d2);
                    setCountDownTimer(d2);
                }
                break;
            case 'COMPLETED':
            case 'CANCELLED':
            case 'FAILED':
            case 'ERROR':
            case 'EXPIRED':
                displayGeneric();
                break;
        }
    }

    function displayGeneric() {
        let section1 = document.getElementById("section1");
        let divText = document.getElementById("trxText");
        let timeLeft = document.getElementById("timeLeft");
        let header = document.getElementById("codiHeader");
        
        section1.innerHTML = '<div class="codiImageContainer codiCentered"><img src="/dashboard/img/codi/' + _json.status + '.svg" alt="' + _messages.get(_json.status).text2 + '"></div>';
        divText.innerHTML = '<div class="codiMessage">' + _messages.get(_json.status).text2 + '</div>';
        let str = _messages.get(_json.status).text1;
        timeLeft.innerHTML = str.replace("#EXPIRATION#", _json.due_date).replace("#ERROR#", "404");
        header.innerHTML = '';
    }

    async function requestStatus(trxId) {
        try {
            const response = await fetch(_url + trxId);
            const json = await response.json();
            if (response && response.ok) {            	
                _json.id = json.id;
                _json.description = json.description
                _json.amount = json.amount;
                _json.due_date = json.due_date;
                _json.qrcode_url = json.qrcode_url;
                _json.qrcode_base64 = json.qrcode_base64;
                _json.push_phone = json.push_phone;
                _json.status = json.status;

                /*// BORRAME
                _json.id = "aksjnclksdjfnv";
                _json.description = "Venta express";
                _json.amount = "300.00";
                _json.due_date = "2020-02-27T17:28";
                _json.qrcode_url = json.qrcode_url;
                _json.push_phone = '4428679903';
                _json.status = "CHARGE_PENDING";
                */
                return json;
            } else {
                console.error(response);
                throw new Error("Server response: not OK");
            }
        } catch (e) {
            throw new RequestError(e);
        }
    }

    function displayAmount(amt) {
    	console.log(amt);
        let str = "0<sup>.00</sup>";
        if (amt) {
            let vint = Math.trunc(amt);
            let vdec = amt - Math.trunc(amt);
            if (('' + vdec).length === 1) {
                vdec = '0' + vdec;
            } else {
                vdec = ('' + vdec).substr(0, 2);
            }
            str = '<div class="codiAmount">$' + vint + '<sup>.' + vdec + '</sup></div><div class="codiCurrency">&nbsp;mxn</div>' +
                '<div id="timeLeft" class="codiTimeLeft">Tiempo restante para efectuar su pago:<div>';
        }
        return str;
    }

    function displayImage(base, url) {
        let str = '<div class="codiImageContainer codiCentered">';
        str += '<img src="data:image/png;base64, ' + base;
        str += '" alt="' + url + '" />';
        return str + "</div>";
    }

    function displayTimeLeft(d1, d2) {
        let str = '<div>';
        let diff = (d2 - d1) / 1000;
        if (diff < 0) {            
            _json.status = 'EXPIRED';
            displayGeneric();
        } else {
            str += '<progress id="progress-bar" class="codiProgressBar" max="' + diff + '" value="' + diff + '"><div></div></progress>';
            str += '<div id="countdown" class="codiProgressLegend"></div>';
        }
        return str + "</div>";
    }

    function setCountDownTimer(d2) {
        let progress = document.getElementById("progress-bar");
        let legend = document.getElementById("countdown");
        let bar = document.querySelector(".codiProgressBar>div");
        let countDownDate = d2.getTime();
        let maxWidth = (countDownDate - (new Date().getTime())) / 1000;

        if (progress) {
            progress.max = progress.value = maxWidth;
            bar.style.width = "100%";
        }

        let x = setInterval(function () {
            let now = new Date().getTime();

            let distance = countDownDate - now;
            if (!progress || distance < 0) {
                clearInterval(_statusInterval);
                clearInterval(x);
                _json.status = 'EXPIRED';
                displayGeneric();
                return;
            }

            if (progress) {
                progress.value--;
                bar.style.width = ((distance / maxWidth) * 100) + "%";
            } 

            let days = Math.floor(distance / (1000 * 60 * 60 * 24));
            let hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            let minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            let seconds = Math.floor((distance % (1000 * 60)) / 1000);

            let legendStr = "Expira en ";
            if (days > 0) {
                legendStr += days + "d ";
            }
            if (hours > 0) {
                legendStr += hours + "h ";
            }
            if (minutes > 0) {
                legendStr += minutes + "m ";
            }
            if (seconds > 0) {
                legendStr += seconds + "s ";
            }

            legend.innerHTML = legendStr;
        }, 1000);
    }

    function displayStructure() {
        let html = '<div class="codiMasterContainer">';
        html += '<div id="codiHeader" class="codi"></div>';
        html += '<section id="section1" class="codi"></section>';
        html += '<section id="section2" class="codi"><div class="codiRow"><div id="trxAmount"></div></div><div class="codiRow"><div id="trxText"></div></div></section>';
        html += '<div id="codiFooter" class="codi"><img class="codiCentered" src="/dashboard/img/codi/Openpay_powered.svg" alt="Powered by Openpay"></div>';
        return html;
    }

    function displayChargePendingHeader(isPush) {
        let html = '<div class="codiCentered">';
        html += '<div class="codiHeaderRow1">';
        html += '<div class="codiHeaderImage"><img src="/dashboard/img/codi/QR.svg" alt="QRC"></div>';
        if (isPush) {
            html += '<div class="codiHeaderText">Utilizar la aplicación móvil de banco para hacer el pago de la notificación</div>';
        } else {
            html += '<div class="codiHeaderText">Utilizar la aplicación móvil de banco para escanear el código QR</div>';
        }

        html += '</div>';
        html += '<div class="headerRow2">';
        html += '<div class="headerCodi">Pago con CoDi&#174;</div>';
        html += '</div>';
        return html;
    }

    const WAITING_FOR_PUSH_NOTIFICATION = '<div class="codiImageContainer codiCentered"><img src="/dashboard/img/codi/push.gif" alt="Esperando pago"></div>';
}());
