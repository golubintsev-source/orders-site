const REPORT_HTML = `
  <article class="contractor-report-article">
    <h1>Проверка деловой репутации ООО «Юнион Полимер Технолоджи»</h1>
    <div class="contractor-report-meta">
      <p><strong>Дата исследования:</strong> 17 октября 2026 года</p>
      <p><strong>Цель:</strong> оценка надежности потенциального поставщика материалов для производства и монтажа пластиковых окон.</p>
      <p><strong>Предполагаемые условия сотрудничества:</strong> регулярные закупки, оплата по безналичному расчету.</p>
    </div>

    <section>
      <h2>1. Краткий вывод</h2>
      <p class="contractor-report-verdict contractor-report-verdict--warning">🟡 <strong>Предварительная оценка риска: УМЕРЕННЫЙ, с отдельными существенными юридическими рисками.</strong></p>
      <p>Компания «Юнион Полимер Технолоджи» существует более 13 лет, ведет хозяйственную деятельность и имеет значительную выручку.</p>
      <p>Однако обнаружены судебные споры, в которых компания выступала ответчиком по требованиям о взыскании задолженности и неустойки.</p>
      <p><strong>Главный выявленный риск:</strong> в 2024–2025 годах суды установили нарушение компанией обязательств по оплате поставленного оборудования и выполненных работ.</p>
      <p>При этом необходимо уточнить юридическое лицо, с которым вы собираетесь заключать договор. Найденная организация зарегистрирована в Московской области, а не в Волгограде.</p>
    </section>

    <section>
      <h2>2. Сведения о компании</h2>
      <p>По открытым источникам обнаружено следующее юридическое лицо:</p>
      <div class="contractor-report-table-wrap">
        <table>
          <thead><tr><th>Показатель</th><th>Информация</th></tr></thead>
          <tbody>
            <tr><td>Наименование</td><td>ООО «Юнион Полимер Технолоджи»</td></tr>
            <tr><td>ИНН</td><td>7701998380</td></tr>
            <tr><td>ОГРН</td><td>1137746425740</td></tr>
            <tr><td>Дата регистрации</td><td>20.05.2013</td></tr>
            <tr><td>Юридический адрес</td><td>Московская область, Сергиев Посад, ул. Фабричная, д. 7</td></tr>
            <tr><td>Генеральный директор</td><td>Кувшинов Максим Михайлович</td></tr>
            <tr><td>Уставный капитал</td><td>3 млн рублей</td></tr>
            <tr><td>Выручка за 2025 год</td><td>9,12 млрд рублей</td></tr>
            <tr><td>Чистая прибыль за 2025 год</td><td>24,19 млн рублей</td></tr>
            <tr><td>Статус</td><td>Действующая организация</td></tr>
          </tbody>
        </table>
      </div>
      <p class="contractor-report-sources">Источники: <a href="https://companies.rbc.ru/id/1137746425740-ooo-yunion-polimer-tehnolodzhi/" target="_blank" rel="noopener noreferrer">РБК Компании</a>, <a href="https://www.tbank.ru/business/contractor/legal/1137746425740/" target="_blank" rel="noopener noreferrer">Т-Банк — проверка контрагента</a>.</p>

      <h3>Что заслуживает внимания</h3>
      <p>Выручка компании за 2025 год составила примерно 9,12 млрд рублей против 14,04 млрд рублей за предыдущий год.</p>
      <p><strong>Снижение выручки — около 35%.</strong></p>
      <p>При этом чистая прибыль за 2025 год составила только 24,19 млн рублей.</p>
      <p>Рентабельность по чистой прибыли — приблизительно <strong>0,27%</strong>.</p>
      <p>Это низкий показатель относительно оборота.</p>
      <p>Сам по себе он не означает финансовую нестабильность, но требует дополнительной проверки задолженности, ликвидности и денежных потоков.</p>
    </section>

    <section>
      <h2>3. Судебные разбирательства</h2>
      <p class="contractor-report-verdict contractor-report-verdict--danger">🔴 <strong>Обнаружены подтвержденные судебные решения не в пользу компании.</strong></p>

      <h3>Дело № А40-150010/2023</h3>
      <p><strong>Предмет спора:</strong> взыскание задолженности по договору поставки оборудования.</p>
      <p>Истец — Ningbo Klauste Imp And Exp Limited.</p>
      <p>Ответчик — ООО «Юнион Полимер Технолоджи».</p>
      <p>Суд установил, что компания не выполнила обязательства по оплате в полном объеме.</p>
      <p><strong>Сумма задолженности: 16 980 долларов США.</strong></p>
      <p>22 апреля 2024 года суд удовлетворил требования истца.</p>
      <p>Впоследствии судебные акты были оставлены в силе вышестоящими инстанциями.</p>

      <h3>Дело № А40-191342/2024</h3>
      <p><strong>Предмет спора:</strong> взыскание договорной неустойки за просрочку оплаты.</p>
      <p>Истец — ООО «Альянс-Пром».</p>
      <p>Ответчик — ООО «Юнион Полимер Технолоджи».</p>
      <p>Первоначально истец требовал взыскать неустойку в размере 291 597,75 доллара США с последующим начислением.</p>
      <p>Суд удовлетворил требования частично.</p>
      <p><strong>Результат:</strong></p>
      <ul>
        <li>Взыскана неустойка 16 242 доллара США в рублевом эквиваленте.</li>
        <li>Предусмотрено дальнейшее начисление неустойки на задолженность 16 980 долларов США до фактического погашения.</li>
        <li>Во встречных требованиях компании отказано.</li>
      </ul>
      <p>21 июля 2025 года Арбитражный суд Московского округа оставил судебные акты без изменения.</p>
      <p class="contractor-report-sources">Источник: <a href="https://base.garant.ru/69495698/" target="_blank" rel="noopener noreferrer">Постановление Арбитражного суда Московского округа от 21.07.2025 № Ф05-7886/2025</a>.</p>

      <h3>Оценка судебных рисков</h3>
      <p class="contractor-report-verdict contractor-report-verdict--danger">🔴 <strong>Негативный фактор: подтвержденное судом нарушение платежных обязательств.</strong></p>
      <p>Однако есть важный нюанс.</p>
      <p>В рассмотренном деле компания выступала покупателем оборудования, а не поставщиком материалов.</p>
      <p>Поэтому этот спор подтверждает проблемы с исполнением отдельных финансовых обязательств, но не доказывает, что компания систематически нарушает сроки поставок своим клиентам.</p>
      <p>Также обнаружены другие судебные дела, включая споры по договорам поставки и оказания услуг. Их обстоятельства и результаты требуют отдельной проверки.</p>
      <p class="contractor-report-sources">Реестр судебных документов: <a href="https://sudact.ru/arbitral/participant/JHLIv0FIfUgx/" target="_blank" rel="noopener noreferrer">СудАкт — судебные дела ООО «Юнион Полимер Технолоджи»</a>.</p>
    </section>

    <section>
      <h2>4. Банкротство и исполнительные производства</h2>
      <p class="contractor-report-verdict contractor-report-verdict--warning">🟡 <strong>Статус: требуется дополнительная проверка.</strong></p>
      <p>В открытых источниках обнаружено упоминание банкротного судебного дела № А41-84564/2017, связанного с организацией.</p>
      <p>Однако на основании найденной информации нельзя утверждать, что компания была признана банкротом.</p>
      <p>Кроме того, в ходе исследования не удалось достоверно установить актуальное количество действующих исполнительных производств и общую сумму непогашенных взысканий.</p>
      <p>Это важно проверить перед перечислением существенной предоплаты.</p>
      <p>Официальные источники для проверки:</p>
      <ul>
        <li><a href="https://fssp.gov.ru/iss/ip" target="_blank" rel="noopener noreferrer">ФССП России — банк данных исполнительных производств</a></li>
        <li><a href="https://fedresurs.ru/" target="_blank" rel="noopener noreferrer">Федресурс — сведения о банкротстве</a></li>
        <li><a href="https://kad.arbitr.ru/" target="_blank" rel="noopener noreferrer">Картотека арбитражных дел</a></li>
      </ul>
      <p><strong>Важно:</strong> отсутствие подтвержденных сведений в проведенном поиске не равнозначно отсутствию задолженности или исполнительных производств.</p>
    </section>

    <section>
      <h2>5. Жалобы и репутация среди покупателей</h2>
      <p class="contractor-report-verdict contractor-report-verdict--warning">🟡 <strong>Недостаточно информации для окончательного вывода.</strong></p>
      <p>При поиске по названию компании не удалось обнаружить достаточное количество достоверных независимых отзывов, позволяющих объективно оценить:</p>
      <ul>
        <li>Соблюдение сроков поставки материалов.</li>
        <li>Качество продукции.</li>
        <li>Работу с рекламациями.</li>
        <li>Возврат денежных средств.</li>
        <li>Выполнение гарантийных обязательств.</li>
      </ul>
      <p>Массовые подтвержденные жалобы покупателей в изученных результатах не выявлены.</p>
      <p>Но считать это доказательством безупречной репутации нельзя.</p>
      <p>Для вашего бизнеса особенно важно проверить отзывы именно производителей пластиковых окон, закупающих у компании материалы на постоянной основе.</p>
    </section>

    <section>
      <h2>6. Основные риски сотрудничества</h2>
      <div class="contractor-report-table-wrap">
        <table>
          <thead><tr><th>Риск</th><th>Оценка</th><th>Комментарий</th></tr></thead>
          <tbody>
            <tr><td>Прекращение деятельности</td><td>🟢 Низкий по имеющимся данным</td><td>Компания действует более 13 лет</td></tr>
            <tr><td>Судебные споры</td><td>🔴 Повышенный</td><td>Есть решения о взыскании задолженности и неустойки</td></tr>
            <tr><td>Финансовая устойчивость</td><td>🟡 Требует внимания</td><td>Существенное снижение выручки и низкая чистая рентабельность</td></tr>
            <tr><td>Непоставка оплаченных материалов</td><td>🟡 Не установлен</td><td>Недостаточно данных о выполнении заказов клиентов</td></tr>
            <tr><td>Банкротство</td><td>🟡 Не подтвержден</td><td>Требуется актуальная проверка</td></tr>
            <tr><td>Качество продукции</td><td>🟡 Не оценено</td><td>Недостаточно независимых отзывов</td></tr>
            <tr><td>Юридическая идентификация поставщика</td><td>🔴 Требует проверки</td><td>Вы указали Волгоград, найденное ООО зарегистрировано в Московской области</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>7. Рекомендации для вашего бизнеса</h2>
      <p>С учетом того, что ваша компания занимается производством и монтажом пластиковых окон, я бы рекомендовал <strong>начать сотрудничество, но не переводить крупные суммы авансом без дополнительных гарантий</strong>.</p>
      <p>Для первых поставок желательно предусмотреть следующие условия:</p>
      <ol class="contractor-report-recommendations">
        <li><strong>Минимальная предоплата.</strong><p>По возможности использовать оплату после получения материалов либо частичную предоплату с окончательным расчетом после приемки.</p></li>
        <li><strong>Четкие сроки поставки.</strong><p>В договоре необходимо установить конкретные сроки отгрузки и ответственность поставщика за их нарушение.</p></li>
        <li><strong>Проверка качества.</strong><p>Зафиксировать требования к материалам, сертификатам, техническим характеристикам и порядку предъявления претензий.</p></li>
        <li><strong>Проверка банковских реквизитов.</strong><p>Оплату производить исключительно на расчетный счет юридического лица, указанного в договоре.</p></li>
        <li><strong>Пробная поставка.</strong><p>Начать с небольшой партии материалов и проверить фактические сроки поставки, качество продукции и работу менеджеров.</p></li>
        <li><strong>Проверка документов.</strong><p>До заключения договора запросить актуальную выписку ЕГРЮЛ, реквизиты, документы о полномочиях подписанта и подтверждение полномочий волгоградского подразделения.</p></li>
      </ol>
    </section>

    <section>
      <h2>8. Итоговое заключение</h2>
      <p class="contractor-report-final-verdict">🟡 <strong>Предварительный вердикт: СОТРУДНИЧЕСТВО ВОЗМОЖНО С ОГРАНИЧЕНИЯМИ</strong></p>
      <p><strong>Положительные факторы:</strong></p>
      <ul>
        <li>Компания работает с 2013 года.</li>
        <li>Имеет значительный оборот.</li>
        <li>По найденным сведениям продолжает деятельность.</li>
        <li>Имеет зарегистрированные товарные знаки.</li>
      </ul>
      <p><strong>Негативные факторы:</strong></p>
      <ul>
        <li>Подтвержденные судебные решения о взыскании задолженности и неустойки.</li>
        <li>Существенное снижение выручки за 2025 год.</li>
        <li>Низкая рентабельность по чистой прибыли.</li>
        <li>Не установлен актуальный объем исполнительных производств.</li>
        <li>Недостаточно независимых отзывов покупателей.</li>
      </ul>
      <p><strong>Моя рекомендация:</strong> рассматривать компанию как потенциального поставщика, но до завершения проверки не соглашаться на значительную предоплату и не делать ее единственным поставщиком критически важных материалов.</p>
    </section>

    <section>
      <h2>Важное уточнение для завершения проверки</h2>
      <p>Вы написали: <strong>«Юнион Полимер Технолоджи Волгоград»</strong>.</p>
      <p>Однако найденная мной организация с ИНН 7701998380 зарегистрирована в Сергиевом Посаде Московской области.</p>
      <p>Возможно, в Волгограде находится ее филиал, представительство, склад или отдельная компания-дистрибьютор.</p>
      <p><strong>Уточните, пожалуйста, один момент:</strong></p>
      <p>У вас есть <strong>ИНН компании из Волгограда</strong>, коммерческое предложение, счет на оплату или карточка предприятия?</p>
      <p>Достаточно прислать ИНН либо фотографию реквизитов.</p>
      <p>Это позволит установить, действительно ли речь идет о проверенном юридическом лице, и провести более точную проверку, в частности:</p>
      <ul>
        <li>Все судебные дела, где компания выступала <strong>ответчиком по искам покупателей</strong>.</li>
        <li>Судебные решения о <strong>непоставке товара, нарушении сроков и возврате авансов</strong>.</li>
        <li>Актуальные исполнительные производства и долги.</li>
        <li>Жалобы производителей пластиковых окон и других покупателей.</li>
        <li>Признаки финансовых проблем и возможного банкротства.</li>
      </ul>
      <p><strong>Особенно важно проверить именно судебные споры с покупателями материалов, поскольку для вас главный риск — оплатить товар и не получить его вовремя.</strong></p>
    </section>
  </article>
`;

let initialized = false;
let previousFocus = null;
let checks = [];
let pollingTimer = null;
let clientPromise = null;

const STATIC_CHECK = {
  id: "union-polymer",
  created_at: "2026-10-17T00:00:00.000Z",
  company_name: "ООО «Юнион Полимер Технолоджи»",
  inn: "7701998380",
  status: "ready",
  static: true,
};

const STATUS_LABELS = {
  working: "В работе",
  ready: "Готово",
  error: "Ошибка",
};

function getClient() {
  if (!clientPromise) {
    clientPromise = import("./config.js").then((module) => module.supabaseClient);
  }
  return clientPromise;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function renderChecks() {
  const tbody = document.getElementById("contractorChecksTbody");
  if (!tbody) return;
  tbody.replaceChildren();

  const rows = [STATIC_CHECK, ...checks].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
  for (const check of rows) {
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    const time = document.createElement("time");
    time.dateTime = String(check.created_at || "").slice(0, 10);
    time.textContent = formatDate(check.created_at);
    dateCell.append(time);

    const companyCell = document.createElement("td");
    if (check.status === "ready" && (check.static || check.report_markdown)) {
      const link = document.createElement("a");
      link.href = check.static ? "#union-polymer-report" : `#contractor-report-${check.id}`;
      link.className = "contractor-checks-report-link";
      link.dataset.checkId = String(check.id);
      link.setAttribute("aria-haspopup", "dialog");
      link.textContent = check.company_name;
      companyCell.append(link);
    } else {
      companyCell.textContent = check.company_name;
    }

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `contractor-check-status contractor-check-status--${check.status}`;
    status.textContent = STATUS_LABELS[check.status] || check.status;
    if (check.status === "error" && check.error_message) status.title = check.error_message;
    statusCell.append(status);

    row.append(dateCell, companyCell, createCell(check.inn || "—"), statusCell);
    tbody.append(row);
  }
}

function appendTextWithLinks(container, rawText) {
  const text = String(rawText || "").replace(/\*\*/g, "");
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    const link = document.createElement("a");
    link.href = match[2] || match[3];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = match[1] || match[3];
    container.append(link);
    cursor = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

export function renderReportMarkdown(markdown, sources = []) {
  const article = document.createElement("article");
  article.className = "contractor-report-article";
  let list = null;

  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (heading) {
      list = null;
      const level = Math.min(3, heading[1].length);
      const element = document.createElement(`h${level}`);
      appendTextWithLinks(element, heading[2]);
      article.append(element);
    } else if (bullet || numbered) {
      const tag = numbered ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        article.append(list);
      }
      const item = document.createElement("li");
      appendTextWithLinks(item, (bullet || numbered)[1]);
      list.append(item);
    } else {
      list = null;
      const paragraph = document.createElement("p");
      appendTextWithLinks(paragraph, line);
      article.append(paragraph);
    }
  }

  const safeSources = Array.isArray(sources)
    ? sources.filter((source) => /^https?:\/\//i.test(String(source?.url || "")))
    : [];
  if (safeSources.length) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = "Источники";
    const listElement = document.createElement("ul");
    for (const source of safeSources) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = String(source.title || source.url);
      item.append(link);
      listElement.append(item);
    }
    section.append(heading, listElement);
    article.append(section);
  }
  return article;
}

function closeReport(dialog) {
  if (!dialog?.open) return;
  dialog.close();
}

function openReport(check) {
  const dialog = document.getElementById("contractorReportDialog");
  const body = document.getElementById("contractorReportBody");
  const closeBtn = document.getElementById("contractorReportCloseBtn");
  const title = document.getElementById("contractorReportDialogTitle");
  if (!dialog || !body || !closeBtn) return;

  previousFocus = document.activeElement;
  if (check.static) {
    body.innerHTML = REPORT_HTML;
  } else {
    body.replaceChildren(renderReportMarkdown(check.report_markdown, check.sources));
  }
  if (title) title.textContent = `Отчет: ${check.company_name}`;
  dialog.showModal();
  document.body.classList.add("contractor-report-open");
  body.scrollTop = 0;
  closeBtn.focus();
}

function setMessage(text) {
  const element = document.getElementById("contractorChecksMessage");
  if (element) element.textContent = text || "";
}

function stopPolling() {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
}

function schedulePolling() {
  stopPolling();
  if (!checks.some((check) => check.status === "working")) return;
  pollingTimer = setTimeout(() => void loadContractorChecks(), 5000);
}

export async function loadContractorChecks() {
  try {
    const supabaseClient = await getClient();
    const { data, error } = await supabaseClient
      .from("contractor_checks")
      .select("id,created_at,company_name,inn,status,report_markdown,sources,error_message")
      .order("created_at", { ascending: false });
    if (error) throw error;
    checks = Array.isArray(data) ? data : [];
    setMessage("");
    renderChecks();
  } catch (error) {
    console.error("contractor-checks: load failed", error);
    setMessage("Не удалось обновить список проверок. Повторите попытку позже.");
  } finally {
    schedulePolling();
  }
}

async function runCheck(companyName, inn) {
  const supabaseClient = await getClient();
  const { data: created, error } = await supabaseClient
    .from("contractor_checks")
    .insert({ company_name: companyName, inn })
    .select("id,created_at,company_name,inn,status,report_markdown,sources,error_message")
    .single();
  if (error) throw error;

  checks = [created, ...checks.filter((check) => check.id !== created.id)];
  renderChecks();
  schedulePolling();

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Сессия истекла. Войдите в систему снова.");

  const response = await fetch("/api/contractor-check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ checkId: created.id }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Не удалось выполнить проверку");
  await loadContractorChecks();
}

export function initContractorChecksSection() {
  if (initialized) return;

  const initialStaticLink = document.getElementById("openUnionPolymerReport");
  const closeBtn = document.getElementById("contractorReportCloseBtn");
  const dialog = document.getElementById("contractorReportDialog");
  const body = document.getElementById("contractorReportBody");
  if (!closeBtn || !dialog || !body) return;

  body.innerHTML = REPORT_HTML;
  initialStaticLink?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation?.();
    openReport(STATIC_CHECK);
  });

  const tbody = document.getElementById("contractorChecksTbody");
  tbody?.addEventListener("click", (event) => {
    const link = event.target.closest?.("[data-check-id], [data-static-report]");
    if (!link) return;
    event.preventDefault();
    const id = link.dataset.checkId || link.dataset.staticReport;
    const check = id === STATIC_CHECK.id ? STATIC_CHECK : checks.find((item) => String(item.id) === String(id));
    if (check?.status === "ready") openReport(check);
  });

  closeBtn.addEventListener("click", () => closeReport(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeReport(dialog);
  });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("contractor-report-open");
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    previousFocus = null;
  });

  const formDialog = document.getElementById("newContractorCheckDialog");
  const form = document.getElementById("newContractorCheckForm");
  const companyInput = document.getElementById("contractorCompanyName");
  const innInput = document.getElementById("contractorInn");
  const formError = document.getElementById("contractorCheckFormError");

  const closeForm = () => {
    if (formDialog?.open) formDialog.close();
  };
  document.getElementById("newContractorCheckBtn")?.addEventListener("click", () => {
    form?.reset();
    if (formError) formError.textContent = "";
    formDialog?.showModal();
    companyInput?.focus();
  });
  document.getElementById("newContractorCheckCloseBtn")?.addEventListener("click", closeForm);
  document.getElementById("newContractorCheckCancelBtn")?.addEventListener("click", closeForm);
  formDialog?.addEventListener("click", (event) => {
    if (event.target === formDialog) closeForm();
  });
  innInput?.addEventListener("input", () => {
    innInput.value = innInput.value.replace(/\D/g, "").slice(0, 12);
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const companyName = companyInput?.value.trim() || "";
    const inn = innInput?.value.replace(/\D/g, "") || "";
    if (!companyName || !/^(?:\d{10}|\d{12})$/.test(inn)) {
      if (formError) formError.textContent = "Заполните название и укажите ИНН из 10 или 12 цифр.";
      return;
    }
    if (formError) formError.textContent = "";
    closeForm();
    setMessage("Проверка запущена. Отчет появится в таблице автоматически.");
    void runCheck(companyName, inn)
      .catch((error) => {
        console.error("contractor-checks: run failed", error);
        setMessage(error?.message || "Не удалось запустить проверку.");
        void loadContractorChecks();
      });
  });

  initialized = true;
}

export function leaveContractorChecksSection() {
  stopPolling();
}
