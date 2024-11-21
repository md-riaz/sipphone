let UA, _sessions = registerer = {}, callPopupWindow;
let soundPlayer = new Audio();
soundPlayer.volume = 1;

window.phone = {
	createUA: () => {
		console.log('Creating SIP UA');

		const uri = SIP.UserAgent.makeURI(sip_uri);
		const transportOptions = {
			server: ws_servers
		};
		const userAgentOptions = {
			uri: uri,
			transportOptions: transportOptions,
			authorizationUsername: uri.user,
			authorizationPassword: sip_password,
			displayName: display_name,
			userAgentString: `${chrome.runtime.getManifest().name} ${chrome.runtime.getManifest().version}`
		};

		UA = new SIP.UserAgent(userAgentOptions);

		UA.delegate = {
			onConnect: () => {
				console.warn('Connected (Unregistered)');
				chrome.browserAction.setTitle({ title: "Connected (Unregistered)" });
				chrome.browserAction.setBadgeBackgroundColor({ color: '#FFFF00' });
				chrome.browserAction.setBadgeText({ text: ' ' });
				chrome.runtime.sendMessage({ action: 'ua_status', status: "connected" });
			},
			onDisconnect: () => {
				console.warn('Disconnected (Unregistered)');
				chrome.browserAction.setTitle({ title: chrome.runtime.getManifest().name });
				chrome.browserAction.setBadgeText({ text: '' });
				chrome.runtime.sendMessage({ action: 'ua_status', status: "unregistered" });
			},
			onInvite: (invitation) => {
				session.newSession(invitation);
			}
		};

		registerer = new SIP.Registerer(UA);

		registerer.stateChange.addListener((state) => {

			switch (state) {
				case SIP.RegistererState.Registered:
					console.info('Connected (Registered)');
					chrome.browserAction.setTitle({ title: "Connected (Registered)" });
					chrome.browserAction.setBadgeBackgroundColor({ color: '#006400' });
					chrome.browserAction.setBadgeText({ text: ' ' });
					chrome.runtime.sendMessage({ action: 'ua_status', status: "registered" });
					break;
				case SIP.RegistererState.Unregistered:
					console.info('Connected (Unregistered)');
					chrome.browserAction.setTitle({ title: "Connected (Unregistered)" });
					chrome.browserAction.setBadgeBackgroundColor({ color: '#800000' });
					chrome.browserAction.setBadgeText({ text: ' ' });
					chrome.runtime.sendMessage({ action: 'ua_status', status: "unregistered" });
					break;
				case SIP.RegistererState.Terminated:
					console.info('Connected (Unregistered Failed)');
					chrome.browserAction.setTitle({ title: "Connected (Unregistered Failed)" });
					chrome.browserAction.setBadgeBackgroundColor({ color: '#800000' });
					chrome.browserAction.setBadgeText({ text: ' ' });
					chrome.runtime.sendMessage({ action: 'ua_status', status: "unregistered" });
					break;
			}
		});

		UA.start().then(() => registerer.register());
	},
	dial: (number, video = false) => {
		console.log('Audio/Video Call : ' + typeof video + video);
		if (registerer && registerer.state === SIP.RegistererState.Registered) {
			if (!isEmpty(number)) {
				const target = SIP.UserAgent.makeURI(`sip:${number}@${UA.configuration.uri.host}`);
				const inviter = new SIP.Inviter(UA, target, {
					sessionDescriptionHandlerOptions: {
						constraints: { audio: true, video: (String(video) == "true") }
					}
				});
				session.newSession(inviter);
				inviter.invite();
			} else {
				notify("Number is required.");
			}
		} else {
			notify("SIP UA is not registered.");
		}
	},
	hangup: (sessionId) => {
		if (_sessions[sessionId]) {
			session.hangup(_sessions[sessionId]);
		}
	},
	answer: (sessionId, _state) => {
		if (_sessions[sessionId]) {
			session.answer(_sessions[sessionId], _state);
		}
	},
	toggleHold: (sessionId, _state) => {
		if (_sessions[sessionId]) {
			session.toggleHold(_sessions[sessionId], _state);
		}
	},
	toggleMute: (sessionId, _state) => {
		if (_sessions[sessionId]) {
			session.toggleMute(_sessions[sessionId], _state);
		}
	},
	sendDTMF: (sessionId, _dtmf) => {
		if (_sessions[sessionId]) {
			session.sendDTMF(_sessions[sessionId], _dtmf);
		}
	},
	blindTx: (sessionId, _blindTxTo) => {
		if (_sessions[sessionId]) {
			session.blindTx(_sessions[sessionId], _blindTxTo);
		}
	},
}

window.session = {
	newSession: (_session) => {
		_sessions[_session.id] = _session;
		const callDirection = (_session instanceof SIP.Invitation) ? 'incoming' : 'outgoing';
		const displayName = (_session.remoteIdentity.displayName) || _session.remoteIdentity.uri.user;
		const _callerNumber = _session.remoteIdentity.uri.user;

		if (callDirection == 'incoming') {
			soundPlayer.setAttribute("src", "assets/sounds/play_file.ogg");
			soundPlayer.setAttribute("loop", "true"); //For continuous ringing
			soundPlayer.play();
		}

		callPopupWindow = window.open('call_popup.html', "callPopup", "resizable = no,status = 1, height = 425, width = 475");
		setTimeout(() => {
			chrome.runtime.sendMessage({
				action: "outgoingCallPopup",
				from: _callerNumber,
				displayName: displayName,
				callDirection: callDirection,
				_sessionId: _session.id
			});
		}, 1000);

		// custom tabs
		chrome.tabs.query({ url: '*://crm.alpha.net.bd/*' }, function (tabs) {
			if (tabs.length > 0) {
				chrome.tabs.update(tabs[0].id, { url: 'https://crm.alpha.net.bd/admin/?q=' + _callerNumber, active: true });
			} else {
				chrome.tabs.create({ url: 'https://crm.alpha.net.bd/admin/?q=' + _callerNumber });
			}
		});


		session.sessionHandler(_session);
	},
	sessionHandler: (_session) => {
		_session.stateChange.addListener((state) => {
			switch (state) {
				case SIP.SessionState.Establishing:
					soundPlayer.pause();
					console.log('Call is in progress');
					break;
				case SIP.SessionState.Established:
					soundPlayer.pause();
					console.log('Call has been accepted');
					chrome.runtime.sendMessage({ action: "callAccepted" });
					let pc = _session.sessionDescriptionHandler.peerConnection;
					let remoteView = document.getElementById('remoteVideo');
					let remoteStream = new MediaStream();
					pc.getReceivers().forEach(function (receiver) {
						remoteStream.addTrack(receiver.track);
					});

					if (typeof remoteView.srcObject !== 'undefined') {
						remoteView.srcObject = remoteStream;
					} else if (typeof remoteView.src !== 'undefined') {
						remoteView.src = window.URL.createObjectURL(remoteStream);
					} else {
						console.log('Error attaching stream to popup remoteVideo element.');
					}

					if (callPopupWindow) {
						let remoteVideoPopup = callPopupWindow.document.getElementById("remoteVideo");
						if (typeof remoteVideoPopup.srcObject !== 'undefined') {
							remoteVideoPopup.srcObject = remoteStream;
						} else if (typeof remoteVideoPopup.src !== 'undefined') {
							remoteVideoPopup.src = window.URL.createObjectURL(remoteStream);
						} else {
							console.log('Error attaching stream to popup remoteVideo element.');
						}
					}

					let localStream = new MediaStream();
					pc.getSenders().forEach(function (sender) {
						localStream.addTrack(sender.track);
					});
					if (localStream) {
						console.log('Received local stream from server in session.on("accepted")', localStream);
						if (callPopupWindow) {
							var localVideoPopup = callPopupWindow.document.getElementById("localVideo");
							if (typeof localVideoPopup.srcObject !== 'undefined') {
								localVideoPopup.srcObject = localStream;
							} else if (typeof localVideoPopup.src !== 'undefined') {
								localVideoPopup.src = window.URL.createObjectURL(localStream);
							} else {
								console.log('Error attaching stream to popup localVideo element.');
							}
						}
					}
					break;
				case SIP.SessionState.Terminated:
					soundPlayer.pause();
					chrome.runtime.sendMessage({ action: "terminated_call" });
					console.log('Call has been ended.');
					delete _sessions[_session.id];
					break;
			}
		});

		_session.delegate = {
			onBye: () => {
				soundPlayer.pause();
				chrome.runtime.sendMessage({ action: "terminated_call" });
				console.log('Call has been ended.');
				delete _sessions[_session.id];
			},
			onInvite: (request) => {
				soundPlayer.pause();
				chrome.runtime.sendMessage({ action: "ended_call", cause: request.cause });
				console.log('Call has been failed due to cause', request.cause);
				delete _sessions[_session.id];
			},
			onCancel: (request) => {
				soundPlayer.pause();
				chrome.runtime.sendMessage({ action: "ended_call", cause: request.cause });
				console.log('Call has been terminated due to cause', request.cause);
				delete _sessions[_session.id];
			}
		};
	},
	hangup: (_session) => {
		if (!_session) {
			return;
		} else if (_session.state === SIP.SessionState.Established) { // Connected
			_session.bye();
		} else if (_session instanceof SIP.Invitation) { // Incoming
			_session.reject();
		} else { // Outbound
			_session.cancel();
		}
	},
	answer: (_session, _state) => {
		if (!_session) {
			return;
		} else if (_session instanceof SIP.Invitation && _session.state === SIP.SessionState.Initial) {
			let options = {
				sessionDescriptionHandlerOptions: {
					constraints: { audio: true, video: _state }
				}
			};
			try {
				_session.accept(options);
				// Send this event to active call so that we can remove incoming call popup
				myEvent.sendTo('active_call', {
					to: 'active_call',
					action: 'call_event',
					type: 'hangup',
					sessionId: _session.id
				});
				// Send this event to active call so that we can Add incoming call popup
				const displayName = (_session && _session.remoteIdentity.displayName) || _session.remoteIdentity.uri.user;
				const _callerNumber = _session.remoteIdentity.uri.user;
				myEvent.sendTo('active_call', {
					to: 'active_call',
					action: 'call_event',
					from: _callerNumber,
					fromName: displayName,
					type: 'notify',
					callDirection: 'answered',
					sessionId: _session.id
				});
			} catch (e) {
				console.log(e);
			}
		}
	},
	toggleHold: (_session, _state) => {
		if (!_session) {
			return;
		}
		if (_state == 'hold') {
			_session.hold();
		} else {
			_session.unhold();
		}
	},
	toggleMute: (_session, _state) => {
		if (!_session) {
			return;
		} else {
			(_state == 'mute') ? _session.mute() : _session.unmute();
		}
	},
	sendDTMF: (_session, _dtmf) => {
		if (!_session) {
			return;
		} else {
			_session.dtmf(_dtmf);
		}
	},
	blindTx: (_session, _blindTxTo) => {
		if (!_session) {
			return;
		} else {
			_session.refer(_blindTxTo, { extraHeaders: ['Referred-By : sip:' + _accountCreds._sipExtension] });
		}
	}
}

let isEmpty = (string) => {
	if (string == null || string == "" || string == undefined) {
		return true;
	} else {
		return false;
	}
}
