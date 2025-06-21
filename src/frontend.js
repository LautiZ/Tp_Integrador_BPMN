// Función de alerta personalizada para mostrar mensajes al usuario
function customAlert(title, message) {
  const modal = document.getElementById("custom-modal");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-message").textContent = message;
  modal.classList.remove("hidden");
  modal.classList.add("flex"); // Usar flexbox para centrado
}

// Cerrar modal cuando se hace clic en el botón de cerrar
function closeModalClick() {
  document.getElementById("custom-modal").classList.add("hidden");
  document.getElementById("custom-modal").classList.remove("flex");
}

// Cerrar modal si se hace clic fuera de su contenido
window.addEventListener("click", (event) => {
  const modal = document.getElementById("custom-modal");
  if (event.target === modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
});

loadBpmnClick();
// Inicializar el visor BPMN.js con new modules for interaction
// Using BpmnNavigatedViewer which includes zoom and pan functionality by default.
const BpmnNavigatedViewer = window.BpmnJS; // bpmn-navigated-viewer.development.js exports to window.BpmnJS
const viewer = new BpmnNavigatedViewer({
  container: "#diagram-viewer",
  // additionalModules are not needed when using bpmn-navigated-viewer as they are built-in
  keyboard: {
    bindTo: document,
  },
});

const loadBpmnBtn = document.getElementById("load-bpmn-btn");

// Elementos de la interfaz de usuario del chatbot
const chatMessagesDiv = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const startChatButton = document.getElementById("start-chat-btn");

// Variables de estado del chatbot
let bpmnProcess = null; // Almacena el proceso principal de BPMN
let elements = {}; // Almacena todos los elementos BPMN (tareas, compuertas, eventos, etc.) por su ID
let currentElement = null; // El elemento BPMN actualmente activo
let isChatActive = false;
let lastHighlightedElementId = null; // Para rastrear el elemento previamente resaltado
let habitacionesDisponibles;
let banderaEleccion = false;
let habitacionElegida;

// Función para añadir un mensaje a la interfaz de chat
function addMessage(sender, text) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");
  if (sender === "bot") {
    messageDiv.classList.add("bot-message");
  } else {
    messageDiv.classList.add("user-message");
  }

  messageDiv.textContent = text;
  chatMessagesDiv.appendChild(messageDiv);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight; // Desplazamiento automático al final
}

// Función para resaltar un elemento BPMN en el visor
function highlightElement(elementId) {
  const canvas = viewer.get("canvas");
  if (lastHighlightedElementId) {
    canvas.removeMarker(lastHighlightedElementId, "highlight");
  }
  canvas.addMarker(elementId, "highlight");
  lastHighlightedElementId = elementId;
}

// Analizar el XML BPMN para extraer elementos y sus conexiones
async function parseBPMN(xml) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xml, "text/xml");
  const bpmnNamespace = "http://www.omg.org/spec/BPMN/20100524/MODEL";

  // Comprobar errores de análisis de XML
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    console.error("Error de DOMParser:", parseError.textContent);
    customAlert(
      "Error de Análisis BPMN",
      `Estructura XML inválida detectada: ${parseError.textContent}`
    );
    return null;
  }

  // Obtener el proceso principal (asumiendo un proceso ejecutable principal para el flujo del chatbot)
  const processes = Array.from(
    xmlDoc.getElementsByTagNameNS(bpmnNamespace, "process")
  );
  // Find the main process, preferably one marked as 'isExecutable'
  let mainProcess = processes.find(
    (p) => p.getAttribute("isExecutable") === "true"
  );
  if (!mainProcess && processes.length > 0) {
    // If no executable process, just take the first one found
    mainProcess = processes[0];
  }

  if (!mainProcess) {
    customAlert(
      "Error de Análisis",
      "No se encontró ningún proceso BPMN en el XML."
    );
    return null;
  }

  const parsedElements = {};
  // Recopilar todos los elementos BPMN relevantes, incluyendo nuevos tipos de compuertas y eventos de captura
  const elementTypes = [
    "startEvent",
    "task",
    "exclusiveGateway",
    "parallelGateway",
    "inclusiveGateway",
    "eventBasedGateway",
    "intermediateCatchEvent",
    "endEvent",
    "subProcess",
    "intermediateThrowEvent",
  ];
  elementTypes.forEach((type) => {
    Array.from(xmlDoc.getElementsByTagNameNS(bpmnNamespace, type)).forEach(
      (el) => {
        if (el.id) {
          const elementData = {
            id: el.id,
            name: el.getAttribute("name") || "",
            type: el.localName,
            outgoing: [],
            incoming: [],
          };

          // For event-based gateways, extract the types of events they are waiting for
          if (type === "eventBasedGateway") {
            elementData.events = [];
            Array.from(el.children).forEach((child) => {
              if (child.localName.endsWith("EventDefinition")) {
                elementData.events.push(
                  child.localName.replace("EventDefinition", "")
                );
              }
            });
          }
          parsedElements[el.id] = elementData;
        }
      }
    );
  });

  // Rellenar flujos de entrada/salida para flujos de secuencia
  Array.from(
    xmlDoc.getElementsByTagNameNS(bpmnNamespace, "sequenceFlow")
  ).forEach((flow) => {
    const sourceRef = flow.getAttribute("sourceRef");
    const targetRef = flow.getAttribute("targetRef");
    const flowName = flow.getAttribute("name") || ""; // The flow name can be used for conditions

    if (parsedElements[sourceRef]) {
      parsedElements[sourceRef].outgoing.push({
        id: flow.id,
        target: targetRef,
        name: flowName,
      });
    }
    if (parsedElements[targetRef]) {
      parsedElements[targetRef].incoming.push({
        id: flow.id,
        source: sourceRef,
        name: flowName,
      });
    }
  });

  return { process: mainProcess, elements: parsedElements };
}

async function obtenerHabitacionesDisponibles() {
  const res = await fetch("/api/habitaciones-disponibles");
  const habitaciones = await res.json();
  return habitaciones;
}

async function reservarHabitacion(id) {
  const res = await fetch(
    `http://localhost:3000/api/reservar-habitacion/${id}`,
    {
      method: "POST",
    }
  );
  const respuesta = await res.json();
  return respuesta;
}

// Simula el progreso del chatbot a través del diagrama BPMN
async function proceedChat(userInputText = "") {
  if (!currentElement) {
    customAlert(
      "Error de Chat",
      "Proceso de chat no inicializado o completado."
    );
    endChat();
    return;
  }

  // Resaltar el elemento actual en el diagrama BPMN
  highlightElement(currentElement.id);

  let botMessage = "";
  let nextElementId = null;
  let expectsUserInput = false;
  let choices = []; // For gateways or tasks that require specific input

  switch (currentElement.type) {
    case "startEvent":
      botMessage = `¡Hola!`;
      nextElementId = currentElement.outgoing[0]?.target;
      break;

    case "task":
    case "subProcess":
      botMessage = `${currentElement.name}`;

      // This section retains original hardcoded task interactions for demonstration.
      // For a truly dynamic chatbot, you might need a more generic way to
      // infer what input a task expects, perhaps from task properties in BPMN XML.
      if (currentElement.name === "Busqueda de disponibilidad") {
        botMessage = "Estamos buscando las habitaciones disponibles...";
        habitacionesDisponibles = await obtenerHabitacionesDisponibles();
        nextElementId = currentElement.outgoing[0]?.target;
      } else if (currentElement.name === "Enviar información al cliente") {
        botMessage = `
            Habitaciones disponibles:\n
            ${habitacionesDisponibles.map((choice) => {
              return ` ${choice.id}`;
            })}
        `;
        nextElementId = currentElement.outgoing[0]?.target;
      } else if (currentElement.name === "Preguntar que día desea reservar.") {
        botMessage = "Que habitacion desea reservar?";
        nextElementId = currentElement.outgoing[0]?.target;
      } else if (currentElement.name === "Confirmar reserva") {
        botMessage = `🔥 Confirmar reserva, 
          La habitacion seleccionada fue la nro ${habitacionElegida.id} y es una ${habitacionElegida.descripcion}
        `;
        nextElementId = currentElement.outgoing[0]?.target;
      } else if (currentElement.name === "Creacion de la reserva") {
        botMessage = "Creando la reserva en la base de datos...";
        await reservarHabitacion(habitacionElegida.id);
        nextElementId = currentElement.outgoing[0]?.target;
        // No user input expected immediately here, it's a processing step
        // The result will be handled in handleUserInput after the "search" is "done"
        // For a real async operation, you'd show a loading state here and then proceed.
        nextElementId = currentElement.outgoing[0]?.target; // Assuming a direct path to the next gateway/task
      } else {
        // For other tasks, simply proceed automatically
        nextElementId = currentElement.outgoing[0]?.target;
      }
      break;

    case "exclusiveGateway":
      botMessage = `Estamos en una decisión en "${currentElement.name}".`;
      expectsUserInput = true;
      choices = currentElement.outgoing
        .map((flow) => flow.name.toLowerCase())
        .filter((name) => name);

      if (choices.length > 0) {
        botMessage += ` Por favor, elija: ${choices.join(" o ")}.`;
      } else {
        botMessage += " Por favor, escriba 'sí' o 'no' para continuar.";
        choices = ["sí", "no"];
      }
      break;

    case "parallelGateway":
      botMessage = `Hemos llegado a un punto de concurrencia en "${currentElement.name}". Las siguientes actividades están ocurriendo en paralelo: `;
      choices = currentElement.outgoing.map(
        (flow) => elements[flow.target]?.name || `Actividad ${flow.target}`
      );
      botMessage += choices.join(", ") + ". ";

      // For simplicity, we'll proceed with the first outgoing path.
      // A true parallel simulation is complex for a linear chatbot.
      nextElementId = currentElement.outgoing[0]?.target;
      if (currentElement.outgoing.length > 1) {
        botMessage +=
          "Continuaré conversando sobre la primera actividad. Por favor, esté atento a las otras actividades en el diagrama.";
      }
      break;

    case "inclusiveGateway":
      botMessage = `Estamos en una decisión inclusiva en "${currentElement.name}". Puede elegir una o varias de las siguientes opciones: `;
      expectsUserInput = true;
      choices = currentElement.outgoing
        .map((flow) => flow.name.toLowerCase())
        .filter((name) => name);
      if (choices.length > 0) {
        botMessage += choices.join(" o ");
      } else {
        botMessage += "Por favor, escriba 'sí' o 'no' para continuar.";
        choices = ["sí", "no"];
      }
      // For simplification, we'll still only process one path based on user input,
      // but the messaging acknowledges the inclusive nature.
      break;

    case "eventBasedGateway":
      botMessage = `Estamos esperando un evento en "${currentElement.name}". `;
      expectsUserInput = true;
      choices = currentElement.outgoing.map(
        (flow) => elements[flow.target]?.name || `Evento en ${flow.target}`
      );
      if (choices.length > 0) {
        botMessage += `Por favor, indique qué evento ha ocurrido: ${choices.join(
          " o "
        )}.`;
      } else {
        botMessage +=
          "No se especificaron eventos. Por favor, intente con 'continuar'.";
        choices = ["continuar"];
      }
      break;

    case "intermediateCatchEvent":
      botMessage = `Responda con un numero`;
      expectsUserInput = true;
      choices = habitacionesDisponibles.map((choice) => {
        return `${choice.id}`;
      });
      break;

    case "intermediateThrowEvent":
      botMessage = `Ha ocurrido un evento: "${currentElement.name}".`;
      nextElementId = currentElement.outgoing[0]?.target;
      break;

    case "endEvent":
      botMessage = `El proceso ha concluido: "${currentElement.name}". ¡Gracias por usar el chatbot!`;
      endChat();
      return; // End chat immediately after displaying message
  }

  addMessage("bot", botMessage);

  if (expectsUserInput) {
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.classList.remove("border-red-300");
    userInput.classList.add("border-gray-300");
    userInput.classList.remove("bg-red-50");
    userInput.classList.add("bg-gray-50");
  } else if (nextElementId) {
    // If no user input is expected, automatically proceed to the next element
    setTimeout(() => {
      currentElement = elements[nextElementId];
      proceedChat();
    }, 1000); // Small delay for readability
  } else {
    // No next element found, likely an unhandled end or BPMN error
    addMessage(
      "bot",
      `Parece que hemos llegado a una parte no manejada del proceso o al final del flujo actual. Por favor, intente iniciar un nuevo chat si tiene más preguntas.`
    );
    endChat();
  }
}

// Función para manejar la entrada del usuario
async function handleUserInput() {
  const userText = userInput.value.trim();
  if (!userText) return;

  addMessage("user", userText);
  userInput.value = ""; // Clear input field

  userInput.disabled = true;
  userInput.classList.remove("border-gray-300");
  userInput.classList.remove("bg-white");
  userInput.classList.add("border-red-300");
  userInput.classList.add("bg-red-50");
  sendButton.disabled = true;

  const userLower = userText.toLowerCase();

  let nextFlow = null;
  const possibleFlows = currentElement.outgoing;
  // Existing logic for other gateways and tasks
  if (
    currentElement.type === "exclusiveGateway" ||
    currentElement.type === "inclusiveGateway" ||
    currentElement.type === "eventBasedGateway" ||
    currentElement.type === "intermediateCatchEvent" || // Handling explicit confirmation for catch events
    currentElement.name === "Qué quiere realizar el usuario?"
  ) {
    for (const flow of possibleFlows) {
      const flowNameLower = flow.name.toLowerCase();
      const targetElementNameLower =
        elements[flow.target]?.name?.toLowerCase() || "";

      // Prioritize matching by flow name
      if (flowNameLower && userLower.includes(flowNameLower)) {
        nextFlow = flow;
        break;
      }
      // For Event-Based Gateways, match user input to the *name of the target event/task*
      if (
        currentElement.type === "eventBasedGateway" &&
        targetElementNameLower &&
        userLower.includes(targetElementNameLower)
      ) {
        nextFlow = flow;
        break;
      }

      // Specific handling for "sí"/"no" in flows without explicit names or with names like "SI"/"NO"
      if (
        (userLower === "sí" || userLower === "si") &&
        (flowNameLower === "si" || flowNameLower === "sí")
      ) {
        nextFlow = flow;
        break;
      }
      if (userLower === "no" && flowNameLower === "no") {
        nextFlow = flow;
        break;
      }

      // Handle 'listo' for intermediate catch events
      if (
        currentElement.type === "intermediateCatchEvent" &&
        habitacionesDisponibles[userLower - 1]
      ) {
        habitacionElegida = habitacionesDisponibles[userLower - 1];
        nextFlow = flow; // Assume catch event proceeds along its only outgoing path
        break;
      }
      // For "Qué quiere realizar el usuario?", map inputs to specific task names
      if (currentElement.name === "Qué quiere realizar el usuario?") {
        if (
          userLower.includes("seguimiento") &&
          elements[flow.target]?.name === "Seguimiento"
        ) {
          nextFlow = flow;
          break;
        }
        if (
          userLower.includes("envio") &&
          elements[flow.target]?.name === "Envío"
        ) {
          nextFlow = flow;
          break;
        }
        if (
          userLower.includes("consulta") &&
          elements[flow.target]?.name === "Consulta"
        ) {
          nextFlow = flow;
          break;
        }
      }
      // For "Solicitud Documentación del usuario?", map "sí" or "no" to correct destinations
      if (currentElement.name === "Solicitud Documentación del usuario") {
        if (
          (userLower.includes("sí") || userLower.includes("si")) &&
          elements[flow.target]?.name ===
            "Verificación de la documentación (¿Documentación completa?)"
        ) {
          nextFlow = flow;
          break;
        }
        if (
          userLower.includes("no") &&
          elements[flow.target]?.name === "Envío cancelado"
        ) {
          nextFlow = flow;
          break;
        }
      }

      // Specific handling for the gateway "Verificación de la documentación (¿Documentación completa?)"
      // If the user says 'no', it should return to 'Solicitud Documentación del usuario'
      if (
        currentElement.name ===
        "Verificación de la documentación (¿Documentación completa?)"
      ) {
        if (userLower.includes("no")) {
          addMessage(
            "bot",
            "Documentación incompleta. Por favor, vuelva a enviar los documentos requeridos."
          );
          // This 'Id_c72c6ce3-757a-4b93-a055-4cc2f27e1caf' is still a hardcoded ID
          currentElement = elements["Id_c72c6ce3-757a-4b93-a055-4cc2f27e1caf"]; // Return to the request task
          userInput.disabled = false;
          userInput.classList.remove("bg-red-50");
          userInput.classList.add("bg-gray-50");
          userInput.classList.remove("border-red-300");
          userInput.classList.add("border-gray-300");
          sendButton.disabled = false;
          return; // Wait for new input
        }
      }
    }

    if (nextFlow) {
      currentElement = elements[nextFlow.target];
      await proceedChat(); // Proceed based on user's choice
    } else {
      let possibleChoices = [];
      if (
        currentElement.type === "exclusiveGateway" ||
        currentElement.name ===
          "Verificación de la documentación (¿Documentación completa?)" ||
        currentElement.name === "¿Se aprueba el envío?" ||
        currentElement.name === "¿Estado del envío completado?" ||
        currentElement.name === "Confirmación de identidad"
      ) {
        possibleChoices = currentElement.outgoing
          .map((flow) => flow.name.toLowerCase())
          .filter((name) => name);
        if (possibleChoices.length === 0) possibleChoices = ["sí", "no"]; // Generic fallback
      } else if (currentElement.type === "inclusiveGateway") {
        possibleChoices = currentElement.outgoing
          .map((flow) => flow.name.toLowerCase())
          .filter((name) => name);
        if (possibleChoices.length === 0) possibleChoices = ["sí", "no"];
      } else if (currentElement.type === "eventBasedGateway") {
        possibleChoices = currentElement.outgoing.map(
          (flow) =>
            elements[flow.target]?.name?.toLowerCase() ||
            `Evento en ${flow.target}`
        );
      } else if (currentElement.type === "intermediateCatchEvent") {
        possibleChoices = habitacionesDisponibles.map((choice) => {
          return `habitacion ${choice.id}`;
        });
      }

      addMessage(
        "bot",
        `No entendí su elección. Por favor, responda con una de las siguientes opciones: ${possibleChoices.join(
          ", "
        )}.`
      );
      userInput.disabled = false; // Enable input again
      userInput.classList.remove("border-red-300");
      userInput.classList.add("border-gray-300");
      userInput.classList.remove("bg-red-50");
      userInput.classList.add("bg-gray-50");
      sendButton.disabled = false;
    }
  } else if (
    currentElement.name === "Solicitud número de seguimiento" ||
    currentElement.name === "Consulta" ||
    currentElement.name === "Decisión administrativa" ||
    currentElement.name === "Generación de número de seguimiento" ||
    currentElement.name === "Realizar envío" ||
    currentElement.name === "Seguimiento" ||
    currentElement.name === "Envío" ||
    currentElement.name === "Validación de identidad" ||
    currentElement.name === "Consulta sobre el envío asociado"
  ) {
    // 'Base de datos (búsqueda de la encomienda)' removed from here
    // For tasks that expect arbitrary text input (like tracking number or general inquiry)
    addMessage("bot", `Recibido: "${userText}". Procesando...`);
    // Assume a direct progression after receiving input for these tasks
    const nextFlow = currentElement.outgoing[0];
    if (nextFlow) {
      currentElement = elements[nextFlow.target];
      await proceedChat();
    } else {
      addMessage(
        "bot",
        `Ocurrió un error inesperado. Por favor, intente de nuevo.`
      );
      endChat();
    }
  } else {
    addMessage(
      "bot",
      `Lo siento, no puedo procesar esa entrada en esta etapa. Por favor, reinicie el chat.`
    );
    endChat();
  }
}

// Cargar el diagrama BPMN cuando se hace clic en el botón
async function loadBpmnClick() {
  // Si el textarea está vacío, cargar el archivo por fetch
  try {
    const response = await fetch("src/utils/bpmn.xml");
    if (!response.ok) throw new Error("No se pudo cargar el archivo bpmn.xml");
    xml = await response.text();
  } catch (err) {
    customAlert("Error", err.message);
    return;
  }

  viewer
    .importXML(xml)
    .then(() => {
      viewer.get("canvas").zoom("fit-viewport");
      // Analizar BPMN para la lógica del chatbot
      parseBPMN(xml).then((parsedResult) => {
        if (parsedResult) {
          bpmnProcess = parsedResult.process;
          elements = parsedResult.elements;
          // Optionally, you can find and highlight the start event after loading
          const startEvent = Object.values(elements).find(
            (el) => el.type === "startEvent"
          );
          if (startEvent) {
            currentElement = startEvent; // Set the initial current element for the visualizer
            highlightElement(currentElement.id);
          }
        } else {
          bpmnProcess = null;
          elements = {};
          currentElement = null;
        }
      });
    })
    .catch((err) => {
      customAlert(
        "Error",
        `No se pudo importar el diagrama BPMN: ${err.message}`
      );
      bpmnProcess = null;
      elements = {};
      currentElement = null;
    });
}

// Manejador del botón Iniciar Chat
function startChatClick() {
  const chatMessagesDiv = document.getElementById("chat-messages");
  chatMessagesDiv.innerHTML = ""; // Clear previous chat
  isChatActive = true;
  // Deshabilitar solo el botón de iniciar chat
  const startBtn = document.querySelector('[onclick="startChatClick()"]');
  if (startBtn) startBtn.disabled = true;

  // El input y el botón de enviar se habilitan/deshabilitan según el flujo del chat

  if (!bpmnProcess || Object.keys(elements).length === 0) {
    customAlert(
      "Error",
      'Por favor, cargue un diagrama BPMN primero haciendo clic en "Cargar Diagrama BPMN".'
    );
    endChat();
    return;
  }

  // Find the start event to begin the chat
  const startEvent = Object.values(elements).find(
    (el) => el.type === "startEvent"
  );
  if (startEvent) {
    currentElement = startEvent;
    proceedChat();
  } else {
    customAlert(
      "Error",
      "No se encontró ningún evento de inicio en el diagrama BPMN cargado. No se puede iniciar el chat."
    );
    endChat();
  }
}

// Manejador del botón Enviar
function sendButtonClick() {
  handleUserInput();
}

// Finalizar el chat de forma elegante
function endChat() {
  isChatActive = false;
  userInput.disabled = true;
  userInput.classList.remove("border-gray-300");
  userInput.classList.remove("bg-white");
  userInput.classList.add("border-red-300");
  userInput.classList.add("bg-red-50");
  sendButton.disabled = true;
  startChatButton.disabled = false;
  currentElement = null;
  // Limpiar el resaltado cuando termina el chat
  if (lastHighlightedElementId) {
    viewer.get("canvas").removeMarker(lastHighlightedElementId, "highlight");
    lastHighlightedElementId = null;
  }
  addMessage(
    "bot",
    "Sesión de chat finalizada. Haga clic en 'Iniciar Chat' para comenzar una nueva conversación."
  );
}
